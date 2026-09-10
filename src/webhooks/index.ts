import axios from "axios";
import { env } from "../env.ts";

export type CreateWebhookProps = {
  baseUrl: string;
};

export const webhookClient = axios.create({
  headers: {
    key: env.KEY,
  },
});
