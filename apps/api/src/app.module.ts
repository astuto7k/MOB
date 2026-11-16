import { Global,Module } from '@nestjs/common';
import { Db } from './db';
import { Security,AuthGuard } from './security';
import { AuthController,AuthService } from './auth';
import { HubService } from './hub';
import { SignalingService } from './signaling';
import { NotificationsController,NotificationsService } from './notifications';
import { AuditController,DeviceController,DevicesController,FilesController,HealthController,PairingController,SessionsController,SettingsController,UsersController } from './controllers';
@Global()
@Module({providers:[Db,Security,AuthGuard,HubService,AuthService],exports:[Db,Security,AuthGuard,HubService,AuthService]})
export class CoreModule {}
@Module({controllers:[AuthController]}) export class AuthModule {}
@Module({controllers:[DevicesController,DeviceController]}) export class DevicesModule {}
@Module({controllers:[PairingController]}) export class PairingModule {}
@Module({controllers:[SessionsController]}) export class SessionsModule {}
@Module({providers:[SignalingService],exports:[SignalingService]}) export class SignalingModule {}
@Module({controllers:[AuditController]}) export class AuditModule {}
@Module({controllers:[FilesController]}) export class FilesModule {}
@Module({controllers:[NotificationsController],providers:[NotificationsService]}) export class NotificationsModule {}
@Module({controllers:[HealthController]}) export class HealthModule {}
@Module({controllers:[SettingsController]}) export class ConfigModule {}
@Module({controllers:[UsersController]}) export class UsersModule {}
@Module({imports:[CoreModule,AuthModule,UsersModule,DevicesModule,PairingModule,SessionsModule,SignalingModule,AuditModule,FilesModule,NotificationsModule,HealthModule,ConfigModule]})
export class AppModule {}
