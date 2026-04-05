import { GoogleAuth } from "google-auth-library";

async function checkAuth() {
  const auth = new GoogleAuth();
  const client = await auth.getClient();
  console.log("Client Type:", client.constructor.name);
  if ((client as any).email) {
    console.log("Service Account Email:", (client as any).email);
  } else if ((client as any).credentials && (client as any).credentials.client_email) {
    console.log("Service Account Email (from credentials):", (client as any).credentials.client_email);
  } else {
    // Try to get from metadata server
    try {
      const { metadata } = require('gcp-metadata');
      const email = await metadata.instance('service-accounts/default/email');
      console.log("Service Account Email (from metadata):", email);
    } catch (e) {
      console.log("Could not get email from metadata server.");
    }
  }
}

checkAuth();
