export interface BookingDates {
  checkin: string;
  checkout: string;
}

export interface Booking {
  firstname?: string;
  lastname?: string;
  totalprice?: number;
  depositpaid?: boolean;
  bookingdates?: BookingDates;
  additionalneeds?: string;
}

export interface CreateBookingResponse {
  bookingid: number;
  booking: Booking;
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token?: string;
  reason?: string;
}
