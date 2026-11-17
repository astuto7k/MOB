import { isEntrypoint } from './entry.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
let hostedApp: ReturnType<typeof createApp> | undefined;
// The Vercel entry forwards every request to the same authenticated Nest application.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
 try {
  const app = await (hostedApp ??= createApp().catch(error => { hostedApp = undefined; throw error; }));
  app.getHttpAdapter().getInstance()(req, res);
 } catch (error) {
  console.error('API initialization failed:', error instanceof Error ? error.name : 'UnknownError');
  if (!res.headersSent) { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({code:'API_UNAVAILABLE',message:'A API não conseguiu iniciar. Confira o banco e a configuração.'})); }
 }
}
if(isEntrypoint(import.meta.url)){void createApp().then(app=>app.listen(config.PORT,'0.0.0.0')).catch(error=>{console.error('API startup failed:',error instanceof Error?error.message:'Unknown error');process.exitCode=1;});}
