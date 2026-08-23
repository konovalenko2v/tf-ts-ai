import { APIRequestContext } from '@playwright/test';
import { config } from '../../core/config';
import { Booking, CreateBookingResponse } from '../types/booking';

const BOOKING_PATH = '/booking/';

export class BookingClient {
  constructor(private readonly request: APIRequestContext) {}

  async createBooking(booking: Booking): Promise<CreateBookingResponse> {
    const response = await this.request.post(`${config.host}${BOOKING_PATH}`, { data: booking });
    if (response.status() !== 200) {
      throw new Error(`createBooking failed with status ${response.status()}`);
    }
    return response.json();
  }

  async getBookingById(id: number) {
    return this.request.get(`${config.host}${BOOKING_PATH}${id}`);
  }

  async getAllBookingIds(): Promise<number[]> {
    const response = await this.request.get(`${config.host}${BOOKING_PATH}`);
    const body = await response.json();
    return body.map((b: { bookingid: number }) => b.bookingid);
  }

  async getBookingIdsFilteredByName(firstname: string, lastname: string): Promise<number[]> {
    const response = await this.request.get(`${config.host}${BOOKING_PATH}`, {
      params: { firstname, lastname },
    });
    const body = await response.json();
    return body.map((b: { bookingid: number }) => b.bookingid);
  }

  async getBookingsFilteredByDates(checkin: string, checkout: string) {
    return this.request.get(`${config.host}${BOOKING_PATH}`, {
      params: { checkin, checkout },
    });
  }

  async updateBooking(id: number, booking: Booking, token: string | null) {
    return this.request.put(`${config.host}${BOOKING_PATH}${id}`, {
      data: booking,
      headers: token ? { Cookie: `token=${token}` } : undefined,
    });
  }

  async partialUpdateBooking(id: number, patchBody: Booking, token: string | null) {
    return this.request.patch(`${config.host}${BOOKING_PATH}${id}`, {
      data: patchBody,
      headers: token ? { Cookie: `token=${token}` } : undefined,
    });
  }

  async deleteBooking(id: number, token: string | null) {
    return this.request.delete(`${config.host}${BOOKING_PATH}${id}`, {
      headers: token ? { Cookie: `token=${token}` } : undefined,
    });
  }
}
