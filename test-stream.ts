import { StreamChat } from "stream-chat";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

console.log("STREAM_API_KEY exists:", !!apiKey);
console.log("STREAM_API_SECRET exists:", !!apiSecret);

if (apiKey && apiSecret) {
  try {
    const client = StreamChat.getInstance(apiKey, apiSecret);
    console.log("Stream client initialized successfully.");
  } catch (error) {
    console.error("Stream client initialization failed:", error);
  }
} else {
  console.error("Stream API keys are missing from environment.");
}
