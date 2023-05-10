import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Redirect,
  Render,
} from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import * as moment from 'moment';
import { IsArray, IsIn, IsNumberString, IsString } from 'class-validator';
import {
  Prisma,
  complexes,
  halls,
  movies,
  showtimes,
  tickets,
} from '@prisma/client';

class BuyTicketsDto {
  @IsArray()
  @IsNumberString({}, { each: true })
  seats: number[];

  @IsIn(['cash', 'terminal', 'online'])
  payment: string;
}

class GenerateShowtimesDto {
  @IsString()
  from: string;

  @IsString()
  to: string;

  @IsArray()
  movie: string[];

  @IsArray()
  hall: string[];

  @IsArray()
  price: string[];

  @IsArray()
  time: string[];
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('/showtimes/generate')
  @Redirect()
  async generate(@Body() body: GenerateShowtimesDto) {
    await this.prismaService.$executeRaw`
    
    INSERT INTO showtimes (time, movie_id, hall_id, price)
    SELECT (d + s.time)::TIMESTAMP, s.movie_id, s.hall_id, s.price
    FROM UNNEST(ARRAY[${Prisma.join(body.time)}]::TIME[], ARRAY[${Prisma.join(
      body.movie.map((x) => Number(x)),
    )}], ARRAY[${Prisma.join(
      body.hall.map((x) => Number(x)),
    )}], ARRAY[${Prisma.join(
      body.price.map((x) => Number(x)),
    )}]) as s(time, movie_id, hall_id, price)
    CROSS JOIN generate_series(${body.from}::DATE, ${
      body.to
    }::DATE, '1 day'::INTERVAL) as d;
    
    `;

    return { url: `/showtimes/${body.from}` };
  }

  @Get('/showtimes/generate')
  @Render('generator')
  async scheduleGenerator() {
    const movies = await this.prismaService.$queryRaw<
      movies[]
    >`SELECT m.id, m.title FROM movies m ORDER BY m.id DESC`;

    const halls = await this.prismaService.$queryRaw<
      (halls | { complexes: complexes })[]
    >`SELECT h.id, h.name, c.name as complex_name, c.address as complex_address FROM halls h JOIN complexes c ON h.complex_id = c.id`;

    console.log(halls);

    return { movies, halls };
  }

  @Get('/showtimes/today')
  @Render('showtimes')
  async today() {
    // 2023-03-23
    return this.showtimes(moment().format('YYYY-MM-DD'));
  }

  @Get('/showtimes/:date(\\d{4}-\\d{2}-\\d{2})')
  @Render('showtimes')
  async showtimes(@Param('date') date: string) {
    const mdate = moment(date, 'YYYY-MM-DD');

    const start = mdate.startOf('day').toDate();
    const end = mdate.endOf('day').toDate();

    const showtimes: any[] = await this.prismaService.$queryRaw`

    SELECT s.id, s.time, s.movie_id, m.title 
    FROM showtimes s 
    JOIN movies m ON s.movie_id = m.id
    WHERE ${start} <= s.time AND s.time <= ${end}
    ORDER BY s.time ASC
    
    `;

    // const showtimes = await this.prismaService.showtimes.findMany({
    //   where: {
    //     time: {
    //       gte: mdate.startOf('day').toDate(),
    //       lte: mdate.endOf('day').toDate(),
    //     },
    //   },
    //   include: { movies: true, halls: { include: { complexes: true } } },
    //   orderBy: { time: 'asc' },
    // });

    const groupedShowtimes = new Map<number, typeof showtimes>();
    for (const showtime of showtimes) {
      const list = groupedShowtimes.get(showtime.movie_id) || [];
      list.push(showtime);
      groupedShowtimes.set(showtime.movie_id, list);
    }

    const groups = Array.from(groupedShowtimes.keys()).map((movieId) => {
      const title = groupedShowtimes.get(movieId)[0].title;
      return {
        title,
        showtimes: groupedShowtimes.get(movieId).map((showtime) => ({
          id: showtime.id,
          time: moment(showtime.time).format('HH:mm'),
        })),
      };
    });

    return {
      time: mdate.format('LL'),
      groups,
    };
  }

  @Get('/showtimes/:id')
  @Render('buy')
  async seats(@Param('id') id: number) {
    id = Number(id);

    const showtime: showtimes = (
      await this.prismaService.$queryRaw`
    
    SELECT s.price, s.time, m.title, m.description, h.name as hall_name, c.name as complex_name FROM showtimes s
    JOIN movies m ON s.movie_id = m.id
    JOIN halls h ON s.hall_id = h.id
    JOIN complexes c ON h.complex_id = c.id
    WHERE s.id = ${id}

    `
    )[0];

    const tickets: tickets[] = await this.prismaService.$queryRaw`
        
    SELECT t.seat FROM tickets t
    WHERE t.showtime_id = ${id}

    `;

    // const showtime = await this.prismaService.showtimes.findFirstOrThrow({
    //   where: { id },
    //   include: { movies: true, halls: { include: { complexes: true } } },
    // });

    // const tickets = await this.prismaService.tickets.findMany({
    //   where: { showtime_id: showtime.id },
    // });

    const usedSeats = new Set(tickets.map((ticket) => ticket.seat));

    const rows = Array.from({ length: 8 }, (_, i) => {
      const row = Array.from({ length: 12 }, (_, j) => {
        const seat = i * 12 + j + 1;
        return {
          seat,
          price: showtime.price,
          available: !usedSeats.has(seat),
        };
      });
      return {
        seats: row,
        number: i + 1,
      };
    });

    return {
      showtime,
      rows,
      time: moment(showtime.time).format('lll'),
    };
  }

  @Post('/showtimes/:id')
  @Redirect()
  async buy(@Param('id') showtimeId: number, @Body() dto: BuyTicketsDto) {
    dto.seats = dto.seats.map((x) => Number(x));

    const tickets = await this.prismaService.$queryRaw`

    WITH payment AS (
      INSERT INTO payments (amount, type, transaction_id)
      VALUES (
        (SELECT price FROM showtimes s WHERE s.id = ${showtimeId}) * ${
      dto.seats.length
    }, 
        ${dto.payment}, 
        (CASE WHEN ${
          dto.payment
        } <> 'cash' THEN uuid_generate_v4() ELSE NULL END)
      )
      RETURNING id
    )
    INSERT INTO tickets (payment_id, showtime_id, seat)
    SELECT * 
    FROM UNNEST(ARRAY[(SELECT id FROM payment)], ARRAY[${showtimeId}]) a
    CROSS JOIN UNNEST(ARRAY[${Prisma.join(dto.seats)}]) b
    RETURNING payment_id

    `;

    // const showtime = await this.prismaService.showtimes.findFirstOrThrow({
    //   where: { id: showtimeId },
    //   include: { movies: true, halls: { include: { complexes: true } } },
    // });

    // const payment = await this.prismaService.payments.create({
    //   data: {
    //     amount: showtime.price * dto.seats.length,
    //     type: dto.payment,
    //     transaction_id: dto.payment !== 'cash' ? v4() : null,
    //   },
    // });

    // await this.prismaService.tickets.createMany({
    //   data: dto.seats.map((seat) => ({
    //     payment_id: payment.id,
    //     seat: Number(seat),
    //     showtime_id: showtimeId,
    //   })),
    // });

    return { url: `/payments/${tickets[0].payment_id}` };
  }

  @Get('/payments/:id')
  @Render('payment')
  async postPurchase(@Param('id') paymentId: number) {
    const payment: any = (
      await this.prismaService.$queryRaw`
    
    SELECT p.id, p.amount, p.created_at, p.type, p.transaction_id FROM payments p
    WHERE p.id = ${paymentId}
    
    `
    )[0];

    const tickets = await this.prismaService.$queryRaw`
        
    SELECT t.id, t.seat, s.price, m.title, c.name as complex_name, c.address, h.name as hall_name FROM tickets t
    JOIN showtimes s ON t.showtime_id = s.id
    JOIN movies m ON s.movie_id = m.id
    JOIN halls h ON s.hall_id = h.id
    JOIN complexes c ON h.complex_id = c.id
    WHERE t.payment_id = ${paymentId}

    `;

    // const payment = await this.prismaService.payments.findFirstOrThrow({
    //   where: { id: paymentId },
    // });

    // const tickets = await this.prismaService.tickets.findMany({
    //   where: { payment_id: paymentId },
    //   include: {
    //     showtimes: {
    //       include: { movies: true, halls: { include: { complexes: true } } },
    //     },
    //   },
    // });

    return {
      payment,
      tickets,
      time: moment(payment.created_at).format('LLLL'),
    };
  }

  @Get('/stats')
  @Render('stats')
  async stats() {
    const movies = await this.prismaService.$queryRaw`
    
    SELECT m.title, count(*)::INT, sum(s.price)::INT as box_office
    FROM tickets t
    JOIN showtimes s ON t.showtime_id = s.id
    JOIN movies m ON s.movie_id = m.id
    GROUP BY m.id
    ORDER BY box_office DESC
    
    `;

    const halls = await this.prismaService.$queryRaw`
        
    SELECT h.name, c.name as complex_name, sum(case when t.id is not null then 1 else 0 end) as count, sum(case when t.id is not null then s.price else 0 end) as box_office from halls h
    left join showtimes s on s.hall_id = h.id
    left join tickets t on t.showtime_id = s.id
    join complexes c on c.id = h.complex_id 
    group by h.id, c.name
    order by box_office desc

    `;

    return { movies, halls };
  }
}
