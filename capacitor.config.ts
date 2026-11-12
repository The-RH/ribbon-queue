import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "org.ribbonqueue.app",
  appName: "Ribbon Queue",
  webDir: "dist/client",
  server: { androidScheme: "https" },
  plugins: { CapacitorHttp: { enabled: true } },
  ios: { contentInset: "automatic" },
  android: { allowMixedContent: true },
};
export default config;
