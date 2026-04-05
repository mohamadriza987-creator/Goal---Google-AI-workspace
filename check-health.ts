import axios from "axios";

(async () => {
  try {
    const response = await axios.get("http://localhost:3000/api/health");
    console.log("Health check response:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Health check failed:", error.response?.data || error.message);
    } else {
      console.error("Health check failed:", error);
    }
  }
})();
