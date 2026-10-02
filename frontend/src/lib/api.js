import axios from "axios";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Surfaces server-sent error messages instead of a generic "Request failed".
export function apiErrorMessage(err) {
  return err?.response?.data?.error || err.message || "Something went wrong";
}
