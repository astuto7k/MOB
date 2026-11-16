import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config';
@Injectable()
export class Db extends PrismaClient implements OnModuleInit,OnModuleDestroy {
 constructor(){ super({adapter:new PrismaPg({connectionString:config.DATABASE_URL,max:config.DATABASE_POOL_SIZE})}); }
 async onModuleInit(){await this.$connect();}
 async onModuleDestroy(){await this.$disconnect();}
}
