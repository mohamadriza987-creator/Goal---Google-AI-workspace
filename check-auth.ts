import { GoogleAuth } from "google-auth-library";

async function checkAuth() {
  const auth = new GoogleAuth();
  const projectId = await auth.getProjectId();
  console.log("Current Project ID from GoogleAuth:", projectId);
  
  const client = await auth.getClient();
  console.log("Service Account Email:", (client as any).email);
}

checkAuth();
