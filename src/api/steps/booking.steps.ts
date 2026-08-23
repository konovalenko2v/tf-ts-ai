import { APIRequestContext, test } from '@playwright/test';
import { BookingClient } from '../clients/booking.client';
import { Booking } from '../types/booking';

export class BookingSteps {
  private readonly bookingClient: BookingClient;

  constructor(request: APIRequestContext) {
    this.bookingClient = new BookingClient(request);
  }

  async createBooking(booking: Booking) {
    return test.step('Create a booking', async () => this.bookingClient.createBooking(booking));
  }

  async getBookingById(id: number) {
    return test.step(`Get booking by id ${id}`, async () => this.bookingClient.getBookingById(id));
  }

  async getAllBookingIds() {
    return test.step('Get all booking ids', async () => this.bookingClient.getAllBookingIds());
  }

  async getBookingIdsFilteredByName(firstname: string, lastname: string) {
    return test.step(`Get booking ids filtered by firstname=${firstname}, lastname=${lastname}`, async () =>
      this.bookingClient.getBookingIdsFilteredByName(firstname, lastname));
  }

  async getBookingsFilteredByDates(checkin: string, checkout: string) {
    return test.step(`Get bookings filtered by checkin=${checkin}, checkout=${checkout}`, async () =>
      this.bookingClient.getBookingsFilteredByDates(checkin, checkout));
  }

  async updateBooking(id: number, booking: Booking, token: string | null) {
    return test.step(`Update booking id ${id}`, async () => this.bookingClient.updateBooking(id, booking, token));
  }

  async partialUpdateBooking(id: number, patchBody: Booking, token: string | null) {
    return test.step(`Partially update booking id ${id}`, async () =>
      this.bookingClient.partialUpdateBooking(id, patchBody, token));
  }

  async deleteBooking(id: number, token: string | null) {
    return test.step(`Delete booking id ${id}`, async () => this.bookingClient.deleteBooking(id, token));
  }
}
