import { APIRequestContext, test } from '@playwright/test';
import { VrrClient } from './vrr.client';
import { LoginIn, ReservationIn } from './types';

export class VrrSteps {
  private readonly vrrClient: VrrClient;

  constructor(request: APIRequestContext) {
    this.vrrClient = new VrrClient(request);
  }

  async login(credentials: LoginIn) {
    return test.step('Log in to VRR', async () => this.vrrClient.login_api_auth_login_post(credentials));
  }

  async logout() {
    return test.step('Log out of VRR', async () => this.vrrClient.logout_api_auth_logout_post());
  }

  async getMe() {
    return test.step('Get the current authenticated user', async () => this.vrrClient.me_api_auth_me_get());
  }

  async getHealth() {
    return test.step('Check API health', async () => this.vrrClient.health_api_health_get());
  }

  async listProperties() {
    return test.step('List properties', async () => this.vrrClient.list_properties_api_properties_get());
  }

  async listReservations(propertyId?: string, status?: string) {
    return test.step(`List reservations (property_id=${propertyId ?? 'any'}, status=${status ?? 'any'})`, async () =>
      this.vrrClient.list_reservations_api_reservations_get(propertyId, status));
  }

  async createReservation(reservation: ReservationIn) {
    return test.step('Create a reservation', async () => this.vrrClient.create_reservation_api_reservations_post(reservation));
  }

  async getReservationById(reservationId: number) {
    return test.step(`Get reservation by id ${reservationId}`, async () =>
      this.vrrClient.get_reservation_api_reservations__reservation_id__get(reservationId));
  }

  async cancelReservation(reservationId: number) {
    return test.step(`Cancel reservation id ${reservationId}`, async () =>
      this.vrrClient.cancel_reservation_api_reservations__reservation_id__delete(reservationId));
  }
}
