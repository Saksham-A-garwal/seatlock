const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// The access token lives here, in memory only -- never in localStorage.
// It's lost on a page reload by design; bootstrapSession() (called once on
// app start) restores it using the httpOnly refresh-token cookie instead.
let currentAccessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}

// Registered by AuthContext: called when a refresh attempt itself fails,
// meaning the session is genuinely gone (not just the in-memory token).
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

// Uses the httpOnly cookie (sent automatically via credentials: "include")
// to obtain a fresh access token. Returns null if there's no valid session.
//
// The refresh token is single-use server-side (rotated on every call), so
// if two requests 401 around the same moment and each independently called
// this, the second would present an already-rotated token and fail --
// logging the user out even though the first call just renewed the session.
// inFlightRefresh makes every concurrent caller share the one real request
// instead, so only one POST /auth/refresh is ever sent at a time.
let inFlightRefresh: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function doRefresh(): Promise<string | null> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    currentAccessToken = null;
    return null;
  }

  const data = (await res.json()) as { accessToken: string };
  currentAccessToken = data.accessToken;
  return data.accessToken;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const doFetch = (): Promise<Response> =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  let res = await doFetch();

  // One automatic refresh-and-retry on a 401 -- the access token expired
  // mid-session, not that the user was never signed in.
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch();
    } else {
      onSessionExpired?.();
    }
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const code = (data?.error?.code as string | undefined) ?? "UNKNOWN_ERROR";
    const message = (data?.error?.message as string | undefined) ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, code, message);
  }

  return data as T;
}

export interface PublicUser {
  id: number;
  email: string;
  role: "USER" | "ADMIN";
}

export function getMe(): Promise<PublicUser> {
  return request<PublicUser>("/auth/me");
}

export function requestOtp(email: string): Promise<{ message: string }> {
  return request("/auth/otp/request", { method: "POST", body: { email } });
}

export function verifyOtp(email: string, code: string): Promise<{ accessToken: string; user: PublicUser }> {
  return request("/auth/otp/verify", { method: "POST", body: { email, code } });
}

export function logout(): Promise<{ message: string }> {
  return request("/auth/logout", { method: "POST" });
}

export interface ShowSummary {
  id: number;
  movieName: string;
  venue: string;
  showtime: string;
  posterUrl: string | null;
  availableSeatCount: number;
}

export function getShows(): Promise<{ shows: ShowSummary[] }> {
  return request("/shows");
}

export interface ShowDetail {
  id: number;
  movieName: string;
  venue: string;
  showtime: string;
  posterUrl: string | null;
}

export type SeatStatus = "AVAILABLE" | "HELD" | "BOOKED";

export interface SeatDto {
  id: number;
  rowLabel: string;
  seatNumber: number;
  status: SeatStatus;
  price: number;
}

export function getSeatMap(showId: number): Promise<{ show: ShowDetail; seats: SeatDto[] }> {
  return request(`/shows/${showId}/seats`);
}

export interface HeldSeat {
  id: number;
  rowLabel: string;
  seatNumber: number;
  price: number;
  status: SeatStatus;
}

export function holdSeats(showId: number, seatIds: number[]): Promise<{ seats: HeldSeat[]; holdExpiresAt: string }> {
  return request(`/shows/${showId}/hold`, { method: "POST", body: { seatIds } });
}

export function createOrder(
  showId: number,
  seatIds: number[]
): Promise<{ orderId: string; paymentId: number; amount: number; currency: string; keyId: string }> {
  return request("/payments/create-order", { method: "POST", body: { showId, seatIds } });
}

export interface PaymentStatusDto {
  id: number;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  bookingId: number | null;
}

export function getPaymentStatus(paymentId: number): Promise<PaymentStatusDto> {
  return request(`/payments/${paymentId}`);
}

export interface BookingDto {
  id: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  totalPrice: number;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  show: ShowDetail;
  seats: { id: number; rowLabel: string; seatNumber: number }[];
}

export function getBookings(): Promise<{ bookings: BookingDto[] }> {
  return request("/bookings");
}

export function cancelBooking(
  bookingId: number
): Promise<{ booking: { id: number; status: string; cancelledAt: string } }> {
  return request(`/bookings/${bookingId}/cancel`, { method: "POST" });
}

export interface CreateShowInput {
  movieName: string;
  venue: string;
  showtime: string;
  rows: number;
  columns: number;
  basePrice: number;
  posterUrl?: string;
}

export function createShow(
  input: CreateShowInput
): Promise<{ show: ShowDetail & { rows: number; columns: number }; seatsCreated: number }> {
  return request("/shows", { method: "POST", body: input });
}

export interface AdminStats {
  totalShows: number;
  totalUsers: number;
  totalBookings: number;
  confirmedBookings: number;
  totalRevenue: number;
}

export function getAdminStats(): Promise<AdminStats> {
  return request("/admin/stats");
}

export interface AdminShowSummary {
  id: number;
  movieName: string;
  venue: string;
  showtime: string;
  posterUrl: string | null;
  totalSeats: number;
  availableSeats: number;
  bookedSeats: number;
  revenue: number;
}

export function getAdminShows(): Promise<{ shows: AdminShowSummary[] }> {
  return request("/admin/shows");
}

export interface AdminBookingDto {
  id: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  totalPrice: number;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  user: { id: number; email: string };
  show: ShowDetail;
  seats: { rowLabel: string; seatNumber: number }[];
}

export function getAdminBookings(status?: AdminBookingDto["status"]): Promise<{ bookings: AdminBookingDto[] }> {
  return request(`/admin/bookings${status ? `?status=${status}` : ""}`);
}
