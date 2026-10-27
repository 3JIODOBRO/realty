import { Body, Controller, Get, Injectable, Logger, Module, NotFoundException, OnModuleInit, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ListingType, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth.module';

export class SearchListingsDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(ListingType) type?: ListingType;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @Type(() => Number) @IsNumber() minPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() rooms?: number;
  @IsOptional() @Type(() => Number) @IsNumber() lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() lng?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Max(100) radiusKm?: number;
  @IsOptional() @IsString() sort?: 'price_asc' | 'price_desc' | 'newest' | 'distance' | 'best_value';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class CreateListingDto {
  @IsEnum(ListingType) type: ListingType;
  @IsString() title: string;
  @IsString() description: string;
  @IsNumber() price: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() rentPeriod?: string;
  @IsNumber() areaM2: number;
  @IsInt() rooms: number;
  @IsString() address: string;
  @IsString() city: string;
  @IsNumber() lat: number;
  @IsNumber() lng: number;
  @IsOptional() @IsArray() photos?: string[];
}

const INDEX = 'listings';

@Injectable()
export class SearchIndexService implements OnModuleInit {
  private log = new Logger('Search');
  private es = new Client({ node: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200' });

  async onModuleInit() {
    try {
      const exists = await this.es.indices.exists({ index: INDEX });
      if (!exists) {
        await this.es.indices.create({
          index: INDEX,
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard' },
              description: { type: 'text' },
              address: { type: 'text' },
              city: { type: 'keyword' },
              type: { type: 'keyword' },
              status: { type: 'keyword' },
              price: { type: 'double' },
              rooms: { type: 'integer' },
              location: { type: 'geo_point' },
            },
          },
        });
      }
    } catch (e) {
      this.log.warn(`Elasticsearch unavailable, falling back to PostgreSQL search: ${(e as Error).message}`);
    }
  }

  async index(l: { id: string; title: string; description: string; address: string; city: string; type: string; status: string; price: unknown; rooms: number; lat: number; lng: number }) {
    await this.es.index({
      index: INDEX,
      id: l.id,
      document: { ...l, price: Number(l.price), location: { lat: l.lat, lon: l.lng } },
    }).catch((e) => this.log.warn(`index failed: ${e.message}`));
  }

  /** Full-text query → ordered ids. Returns null if ES is down so callers can fall back. */
  async searchIds(q: string, f: SearchListingsDto): Promise<string[] | null> {
    try {
      const filter: object[] = [{ term: { status: 'ACTIVE' } }];
      if (f.type) filter.push({ term: { type: f.type } });
      if (f.city) filter.push({ term: { city: f.city } });
      if (f.rooms) filter.push({ term: { rooms: f.rooms } });
      if (f.minPrice || f.maxPrice) filter.push({ range: { price: { gte: f.minPrice, lte: f.maxPrice } } });
      if (f.lat != null && f.lng != null) filter.push({ geo_distance: { distance: `${f.radiusKm ?? 10}km`, location: { lat: f.lat, lon: f.lng } } });
      const res = await this.es.search({
        index: INDEX,
        size: f.limit ?? 24,
        query: { bool: { must: [{ multi_match: { query: q, fields: ['title^3', 'address^2', 'description'], fuzziness: 'AUTO' } }], filter } },
      });
      return res.hits.hits.map((h) => h._id!).filter(Boolean);
    } catch {
      return null;
    }
  }
}

@Injectable()
export class ListingsService {
  constructor(private prisma: PrismaService, private search: SearchIndexService) {}

  async searchListings(f: SearchListingsDto) {
    const limit = f.limit ?? 24;
    if (f.q) {
      const ids = await this.search.searchIds(f.q, f);
      if (ids) {
        const rows = await this.prisma.listing.findMany({ where: { id: { in: ids } } });
        return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
      }
    }

    // PostGIS path: radius filter + distance + "best value" ranking (price per m² vs city median)
    const conds: Prisma.Sql[] = [Prisma.sql`l.status = 'ACTIVE'`];
    if (f.type) conds.push(Prisma.sql`l.type = ${f.type}::"ListingType"`);
    if (f.city) conds.push(Prisma.sql`l.city = ${f.city}`);
    if (f.rooms) conds.push(Prisma.sql`l.rooms = ${f.rooms}`);
    if (f.minPrice != null) conds.push(Prisma.sql`l.price >= ${f.minPrice}`);
    if (f.maxPrice != null) conds.push(Prisma.sql`l.price <= ${f.maxPrice}`);
    if (f.q) conds.push(Prisma.sql`(l.title ILIKE ${'%' + f.q + '%'} OR l.address ILIKE ${'%' + f.q + '%'})`);

    const hasPoint = f.lat != null && f.lng != null;
    const point = hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${f.lng}, ${f.lat}), 4326)::geography` : Prisma.sql`NULL`;
    if (hasPoint) conds.push(Prisma.sql`ST_DWithin(l.location, ${point}, ${(f.radiusKm ?? 10) * 1000})`);

    const order =
      f.sort === 'price_asc' ? Prisma.sql`l.price ASC`
      : f.sort === 'price_desc' ? Prisma.sql`l.price DESC`
      : f.sort === 'distance' && hasPoint ? Prisma.sql`distance_m ASC`
      : f.sort === 'best_value' ? Prisma.sql`value_score ASC`
      : Prisma.sql`l."createdAt" DESC`;

    return this.prisma.$queryRaw`
      WITH city_median AS (
        SELECT city, type, percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF("areaM2", 0)) AS med
        FROM "Listing" WHERE status = 'ACTIVE' GROUP BY city, type
      )
      SELECT l.id, l.title, l.type, l.price, l.currency, l."rentPeriod", l."areaM2", l.rooms, l.address, l.city,
             l.lat, l.lng, l.photos, l."createdAt",
             ${hasPoint ? Prisma.sql`ST_Distance(l.location, ${point})` : Prisma.sql`NULL`} AS distance_m,
             (l.price / NULLIF(l."areaM2", 0)) / NULLIF(cm.med, 0) AS value_score
      FROM "Listing" l
      LEFT JOIN city_median cm ON cm.city = l.city AND cm.type = l.type
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY ${order}
      LIMIT ${limit}`;
  }

  async findOne(id: string) {
    const l = await this.prisma.listing.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true, avatarUrl: true, createdAt: true } } },
    });
    if (!l) throw new NotFoundException('Listing not found');
    return l;
  }

  /** Same type, nearby, price within ±20% — used by the "seller is not answering" nudge. */
  similar(id: string, limit = 3) {
    return this.prisma.$queryRaw<Array<{ id: string; title: string; price: string; address: string }>>`
      SELECT o.id, o.title, o.price::text, o.address
      FROM "Listing" base
      JOIN "Listing" o ON o.id <> base.id AND o.type = base.type AND o.status = 'ACTIVE'
        AND o.price BETWEEN base.price * 0.8 AND base.price * 1.2
        AND ST_DWithin(o.location, base.location, 5000)
      WHERE base.id = ${id}
      ORDER BY ST_Distance(o.location, base.location)
      LIMIT ${limit}`;
  }

  async create(ownerId: string, dto: CreateListingDto) {
    const l = await this.prisma.listing.create({
      data: { ...dto, ownerId, photos: dto.photos ?? [], price: new Prisma.Decimal(dto.price) },
    });
    await this.search.index(l);
    return l;
  }
}

@Controller('listings')
export class ListingsController {
  constructor(private listings: ListingsService) {}

  @Get()
  search(@Query() q: SearchListingsDto) {
    return this.listings.searchListings(q);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.listings.findOne(id);
  }

  @Get(':id/similar')
  similar(@Param('id') id: string) {
    return this.listings.similar(id, 6);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateListingDto) {
    return this.listings.create(u.id, dto);
  }
}

@Module({
  controllers: [ListingsController],
  providers: [ListingsService, SearchIndexService],
  exports: [ListingsService],
})
export class ListingsModule {}
