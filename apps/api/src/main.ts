import { isEntrypoint } from './entry.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as helmetExports from 'helmet';
import type { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module.js';
import { config } from './config.js';
import { ErrorFilter,rateLimit } from './http.js';
import { SignalingService } from './signaling.js';
// Keep a static import for Vercel dependency tracing and an explicit callable type.
const helmet = helmetExports.default as unknown as (options?: import('helmet').HelmetOptions) => RequestHandler;
export async function createApp(){
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:false,logger:['error','warn','log']});
 if(config.TRUST_PROXY==='1')app.set('trust proxy',1);
 app.setGlobalPrefix('api/v1');app.use(helmet());app.use(json({limit:'192kb',strict:true}));app.use(cookieParser());app.use(rateLimit());
 app.enableCors({origin:config.WEB_ORIGIN,credentials:true,methods:['GET','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token','Authorization']});
 app.useGlobalFilters(new ErrorFilter());app.enableShutdownHooks();await app.init();if(process.env.VERCEL!=='1')app.get(SignalingService).attach(app.getHttpServer());return app;
}
if(isEntrypoint(import.meta.url)||process.env.VERCEL==='1'){void createApp().then(app=>app.listen(config.PORT,'0.0.0.0')).catch(error=>{console.error('API startup failed:',error instanceof Error?error.message:'Unknown error');process.exitCode=1;});}
