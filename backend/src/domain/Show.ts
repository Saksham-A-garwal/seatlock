import { Seat } from "./Seat";

interface ShowData {
  id: number;
  movieName: string;
  venue: string;
  showtime: Date;
}

export class Show {
  readonly id: number;
  readonly movieName: string;
  readonly venue: string;
  readonly showtime: Date;
  private readonly seats: Seat[];

  constructor(data: ShowData, seats: Seat[]) {
    this.id = data.id;
    this.movieName = data.movieName;
    this.venue = data.venue;
    this.showtime = data.showtime;
    this.seats = seats;
  }

  getSeats(): Seat[] {
    return this.seats;
  }

  getSeat(seatId: number): Seat | undefined {
    return this.seats.find((seat) => seat.id === seatId);
  }

  availableSeatCount(now: Date = new Date()): number {
    return this.seats.filter((seat) => seat.isAvailable(now)).length;
  }
}
