// app.ts
import express from 'express';
import cors from 'cors';
import routes from './routes';

const app = express();

// CORS middleware – must come BEFORE routes
app.use(
  cors({
    origin: '*', // you can later lock this down to your shop domain
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);


app.use(express.json());
app.use('/api', routes);

export default app;
