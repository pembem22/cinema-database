// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    });
  }

  async onModuleInit() {
    this.$on('query', (e) => {
      let queryString = e.query;
      JSON.parse(e.params).forEach((param, index) => {
        queryString = queryString.replace(
          `$${index + 1}`,
          typeof param === 'string' ? `'${param}'` : param,
        );
      });

      console.log(queryString);
      console.log();
    });

    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    this.$on('beforeExit', async () => {
      await app.close();
    });
  }
}
