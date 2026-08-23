import { faker } from '@faker-js/faker';
import { Booking, BookingDates } from '../types/booking';

export function validBookingDates(): BookingDates {
  return {
    checkin: '2026-08-01',
    checkout: '2026-08-10',
  };
}

export function validBooking(): Booking {
  return {
    firstname: faker.person.firstName(),
    lastname: faker.person.lastName(),
    totalprice: faker.number.int({ min: 50, max: 1000 }),
    depositpaid: faker.datatype.boolean(),
    bookingdates: validBookingDates(),
    additionalneeds: faker.food.dish(),
  };
}

export function bookingWithNames(firstname: string, lastname: string): Booking {
  return { ...validBooking(), firstname, lastname };
}

export function bookingWithTotalPrice(totalprice: number): Booking {
  return { ...validBooking(), totalprice };
}

export function bookingWithDates(checkin: string, checkout: string): Booking {
  return { ...validBooking(), bookingdates: { checkin, checkout } };
}
