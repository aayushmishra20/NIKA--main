import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env without external deps
const loadEnvFromFile = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {}
};

// Load environment variables before checking Firebase config
console.log('🔍 Loading environment variables...');
// Use absolute path to backend root
if (__dirname.includes('dist')) {
  // Running from compiled directory
  loadEnvFromFile(path.join(__dirname, '..', '..', '..', '.env'));
} else {
  // Running from backend root
  loadEnvFromFile('./.env');
}
console.log('🔍 Environment variables loaded');
console.log('🔍 VITE_FIREBASE_PROJECT_ID after loading:', process.env.VITE_FIREBASE_PROJECT_ID);

// Check if Firebase is configured
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebaseServiceAccount.json';
const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '';
const storageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '';
const demoMode = process.env.DEMO_MODE === 'true' || !fs.existsSync(serviceAccountPath);

console.log('🔍 Firebase Configuration Debug:');
console.log('   Service account path:', serviceAccountPath);
console.log('   Service account exists:', fs.existsSync(serviceAccountPath));
console.log('   Project ID:', projectId);
console.log('   Storage bucket:', storageBucket);
console.log('   DEMO_MODE env var:', process.env.DEMO_MODE);
console.log('   Initial demoMode:', demoMode);

let adminApp: admin.app.App | null = null;
let db: admin.firestore.Firestore | null = null;
let bucket: any = null; // Firebase Storage Bucket type

if (!demoMode && projectId && storageBucket) {
  try {
    // Check if service account file exists
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebaseServiceAccount.json';
    const fullPath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : __dirname.includes('dist')
        ? path.join(__dirname, '..', '..', '..', serviceAccountPath)
        : path.join(__dirname, serviceAccountPath);

    if (!fs.existsSync(fullPath)) {
      console.warn('⚠️ Firebase service account file not found, using demo mode');
      console.warn(`   Expected path: ${fullPath}`);
    } else {
      // Initialize Firebase Admin
      const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      // Check if app already initialized
      try {
        adminApp = admin.app();
      } catch {
        adminApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          projectId: projectId || serviceAccount.project_id,
          storageBucket: storageBucket || `${serviceAccount.project_id}.appspot.com`,
        });
      }

      db = admin.firestore();
      bucket = admin.storage().bucket();

      // Connect to emulators if enabled
      const useEmulator = process.env.FIREBASE_USE_EMULATOR === 'true';
      if (useEmulator) {
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
        process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
        console.log('✅ Connected to Firebase Emulators');
      }

      console.log('✅ Firebase Admin initialized');
    }
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
    const err = error as any;
    console.error('   Error details:', err.message || err);
    console.error('   Stack:', err.stack || 'No stack available');
    throw error; // Re-throw to see the actual error
  }
} else {
  console.warn('⚠️ Firebase disabled, using demo/local mode');
}

export { adminApp, admin, db, bucket, demoMode };

