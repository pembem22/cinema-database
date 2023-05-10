import { Module } from '@nestjs/common';
import { ShowtimesService } from './showtimes.service';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  providers: [ShowtimesService],
  imports: [DatabaseModule],
  exports: [ShowtimesService],
})
export class ShowtimesModule {}
