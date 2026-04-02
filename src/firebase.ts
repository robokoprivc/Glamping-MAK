import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// In this environment, we use a local config file
// If it doesn't exist yet, we'll use a placeholder to prevent build errors
let firebaseConfig = {
  apiKey: "placeholder",
  authDomain: "placeholder",
  projectId: "placeholder",
  storageBucket: "placeholder",
  messagingSenderId: "placeholder",
  appId: "placeholder"
};

// We'll try to use the real config if it's available, but we'll do it in a way that doesn't break the build
// For now, we'll just use the placeholder to allow the app to start
// The user can update this later once Firebase setup is successful

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const appId = firebaseConfig.projectId || 'default-app-id';
