import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';
import { config } from './config';
import { ErrorFilter,rateLimit } from './http';
import { SignalingService } from './signaling';
export async function createApp(){
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:false,logger:['error','warn','log']});
 if(config.TRUST_PROXY==='1')app.set('trust proxy',1);
 app.setGlobalPrefix('api/v1');app.use(helmet());app.use(json({limit:'192kb',strict:true}));app.use(cookieParser());app.use(rateLimit());
 app.enableCors({origin:config.WEB_ORIGIN,credentials:true,methods:['GET','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token','Authorization']});
 app.useGlobalFilters(new ErrorFilter());app.enableShutdownHooks();await app.init();if(process.env.VERCEL!=='1')app.get(SignalingService).attach(app.getHttpServer());return app;
}
if(require.main===module||process.env.VERCEL==='1'){void createApp().then(app=>app.listen(config.PORT,'0.0.0.0')).catch(error=>{console.error('API startup failed:',error instanceof Error?error.message:'Unknown error');process.exitCode=1;});}
