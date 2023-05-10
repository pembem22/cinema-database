import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ShowtimesModule } from './showtimes/showtimes.module';
import { DatabaseModule } from './database/database.module';

@Module({
  controllers: [AppController],
  providers: [AppService],
  exports: [DatabaseModule],
  imports: [ShowtimesModule, DatabaseModule],
})
export class AppModule {}
