import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

export class HttpClient {
  private client: AxiosInstance;

  constructor(baseURL?: string, timeout?: number) {
    this.client = axios.create({
      baseURL: baseURL || config.api.baseUrl,
      timeout: timeout || config.api.timeoutMs,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.request.use((req) => {
      logger.debug(`HTTP ${req.method?.toUpperCase()} ${req.url}`);
      return req;
    });

    this.client.interceptors.response.use(
      (res) => {
        logger.debug(`HTTP ${res.status} ${res.config.url}`);
        return res;
      },
      (error) => {
        if (axios.isAxiosError(error)) {
          logger.error(
            `HTTP Error: ${error.response?.status || "NETWORK"} ${error.config?.url} - ${error.message}`,
          );
        }
        return Promise.reject(error);
      },
    );
  }

  setAuthToken(token: string): void {
    this.client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(
      url,
      data,
      config,
    );
    return response.data;
  }

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(
      url,
      data,
      config,
    );
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }
}

export const httpClient = new HttpClient();
