import { APIRequestContext } from '@playwright/test';
import { Booking, CreateBookingResponse } from '../types/booking';
import { parseBody } from '../contract';
import { BookingIdListSchema, CreateBookingResponseSchema } from '../schemas/booking.schema';

const BOOKING_PATH = 'booking/';

export class BookingClient {
  constructor(private readonly request: APIRequestContext) {}

  async createBooking(booking: Booking): Promise<CreateBookingResponse> {
    const response = await this.request.post(BOOKING_PATH, { data: booking });
    if (response.status() !== 200) {
      throw new Error(`createBooking failed with status ${response.status()}`);
    }
    return parseBody(response, CreateBookingResponseSchema);
  }

  async getBookingById(id: number) {
    return this.request.get(`${BOOKING_PATH}${id}`);
  }

  async getAllBookingIds(): Promise<number[]> {
    const response = await this.request.get(BOOKING_PATH);
    const body = await parseBody(response, BookingIdListSchema);
    return body.map((b) => b.bookingid);
  }

  async getBookingIdsFilteredByName(firstname: string, lastname: string): Promise<number[]> {
    const response = await this.request.get(BOOKING_PATH, {
      params: { firstname, lastname },
    });
    const body = await parseBody(response, BookingIdListSchema);
    return body.map((b) => b.bookingid);
  }

  async getBookingsFilteredByDates(checkin: string, checkout: string) {
    return this.request.get(BOOKING_PATH, {
      params: { checkin, checkout },
    });
  }

  async updateBooking(id: number, booking: Booking, token: string | null) {
    return this.request.put(`${BOOKING_PATH}${id}`, {
      data: booking,
      headers: token ? { Cookie: `token=${token}` } : undefined,
    });
  }

  async partialUpdateBooking(id: number, patchBody: Booking, token: string | null) {
    return this.request.patch(`${BOOKING_PATH}${id}`, {
      data: patchBody,
      headers: token ? { Cookie: `token=${token}` } : undefined,
    });
  }

  async deleteBooking(id: number, token: string | null) {
    return this.request.delete(`${BOOKING_PATH}${id}`, {
      headers: token ? { Cookie: `token=${token}` } : undefined,
    });
  }
}
