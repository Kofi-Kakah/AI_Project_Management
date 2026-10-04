import "dotenv/config";
import express from "express";
import { prisma } from "./libs/prisma";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/health", async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: "ok", db: "connected" });
    } catch (error) {
        console.error("Database connection error:", error);
        res.status(500).json({ status: "error", db: "unreachable" });
    }
})

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});