export const env = {
  adminToken: process.env.VECTOR_ADMIN_TOKEN || "cxt1234",
  aliceUrl: process.env.VECTOR_ALICE_URL || "http://alice:8000",
  authUrl: process.env.VECTOR_AUTH_URL || "http://auth:5040",
  bobUrl: process.env.VECTOR_BOB_URL || "http://bob:8000",
  chainProviders: JSON.parse(process.env.VECTOR_CHAIN_PROVIDERS || "{}"),
  contractAddresses: JSON.parse(process.env.VECTOR_CONTRACT_ADDRESSES || "{}"),
  logLevel: parseInt(process.env.VECTOR_LOG_LEVEL || "0", 10),
  natsUrl: process.env.VECTOR_NATS_URL || "http://nats:4222",
  nodeUrl: process.env.VECTOR_NODE_URL || "http://node:8000",
};
