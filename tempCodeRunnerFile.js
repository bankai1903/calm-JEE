import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import validator from "validator";
import xss from "xss";
import compression from "compression";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import cron from "node-cron";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import cluster from "cluster";
import os from "os";
import fs from "fs";
import { promisify } from "util";
import Joi from "joi";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import { v4 as uuidv4 } from "uuid";
import responseTime from "response-time";
import Redis from "ioredis";

// Validate environment variables first
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(5000),
  MONGODB_URI: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  SESSION_SECRET: Joi.string().min(32).required(),
  REDIS_URL: Joi.string(),
  ANTHROPIC_API_KEY: Joi.string().required(),
  ALLOWED_ORIGINS: Joi.string(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  MAX_REQUEST_SIZE: Joi.string().default('10mb'),
  RATE_LIMIT_WINDOW: Joi.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX: Joi.number().default(100),
  BCRYPT_ROUNDS: Joi.number().default(12),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  ENABLE_CLUSTERING: Joi.boolean().default(false)
});

// Load and validate environment
dotenv.config();
const { error: envError, value: env } = envSchema.validate(process.env, { 
  allowUnknown: true,
  abortEarly: false 
});

if (envError) {
  console.error('Environment validation failed:', envError.details);
  process.exit(1);
}

// Clustering setup for production
if (env.ENABLE_CLUSTERING && cluster.isPrimary && env.NODE_ENV === 'production') {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} is running. Forking ${numCPUs} workers...`);
  
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  startServer();
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // ES Module directory setup
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Ensure logs directory exists
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Enhanced Logging with rotation
  const logger = winston.createLogger({
    level: env.LOG_LEVEL,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
      })
    ),
    transports: [
      new DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d'
      }),
      new DailyRotateFile({
        filename: path.join(logsDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d'
      }),
      new winston.transports.Console({
        format: env.NODE_ENV === 'production' 
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
      })
    ],
    exitOnError: false
  });

  // Request correlation middleware
  app.use((req, res, next) => {
    req.correlationId = uuidv4();
    res.setHeader('X-Correlation-ID', req.correlationId);
    next();
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.info('Request processed', {
        correlationId: req.correlationId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    });
    
    next();
  });

  // Response time tracking
  app.use(responseTime());

  // Redis setup for session store and caching
  let redis;
  if (env.REDIS_URL) {
    try {
      redis = new Redis(env.REDIS_URL, {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });
      
      redis.on('connect', () => logger.info('Redis connected successfully'));
      redis.on('error', (err) => logger.error('Redis connection error:', err));
    } catch (error) {
      logger.warn('Redis connection failed, falling back to memory store:', error.message);
    }
  }

  // Database connection with proper error handling and options
  try {
    await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
  });
  
  logger.info('MongoDB connected successfully');
  
} catch (error) {
  logger.error('Failed to connect to MongoDB:', error);
  process.exit(1);

    
    logger.info('MongoDB connected successfully');
    
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    
  } 

  // Import models (these would be in separate files in production)
  const { User, ChatSession, Quiz } = await import('./models/index.js').catch(() => {
    // Fallback to inline models if separate files don't exist
    return createModels();
  });

  function createModels() {
    // Enhanced User Schema with validation and indexes
    const userSchema = new mongoose.Schema({
      username: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30,
        validate: {
          validator: (v) => /^[a-zA-Z0-9_]+$/.test(v),
          message: 'Username can only contain letters, numbers, and underscores'
        }
      },
      email: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        lowercase: true,
        validate: {
          validator: validator.isEmail,
          message: 'Invalid email format'
        }
      },
      password: { 
        type: String, 
        required: true,
        minlength: 8,
        select: false // Don't include in queries by default
      },
      profile: {
        grade: {
          type: String,
          enum: ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'college', 'graduate']
        },
        subjects: {
          type: [String],
          validate: {
            validator: (v) => v.length <= 10,
            message: 'Maximum 10 subjects allowed'
          }
        },
        learningGoals: {
          type: [String],
          validate: {
            validator: (v) => v.length <= 5,
            message: 'Maximum 5 learning goals allowed'
          }
        },
        preferredLanguage: { 
          type: String, 
          default: 'en',
          enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko']
        }
      },
      stats: {
        totalStudyTime: { type: Number, default: 0, min: 0 },
        questionsAsked: { type: Number, default: 0, min: 0 },
        quizzesCompleted: { type: Number, default: 0, min: 0 },
        currentStreak: { type: Number, default: 0, min: 0 },
        bestStreak: { type: Number, default: 0, min: 0 },
        xpPoints: { type: Number, default: 0, min: 0 },
        level: { type: Number, default: 1, min: 1, max: 100 }
      },
      achievements: [{
        name: { type: String, required: true },
        description: String,
        dateEarned: { type: Date, default: Date.now },
        xpReward: { type: Number, default: 0, min: 0 }
      }],
      studyProgress: [{
        subject: { type: String, required: true },
        topic: { type: String, required: true },
        completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
        lastStudied: Date,
        difficultyLevel: { 
          type: String, 
          enum: ['beginner', 'intermediate', 'advanced'], 
          default: 'beginner' 
        }
      }],
      weakAreas: {
        type: [String],
        validate: {
          validator: (v) => v.length <= 20,
          message: 'Maximum 20 weak areas allowed'
        }
      },
      isActive: { type: Boolean, default: true },
      lastLogin: Date,
      loginAttempts: { type: Number, default: 0, max: 5 },
      lockUntil: Date
    }, { 
      timestamps: true,
      toJSON: {
        transform: function(doc, ret) {
          delete ret.password;
          delete ret.loginAttempts;
          delete ret.lockUntil;
          return ret;
        }
      }
    });

    // Indexes for performance
    userSchema.index({ email: 1 });
    userSchema.index({ username: 1 });
    userSchema.index({ 'stats.level': -1 });
    userSchema.index({ lastLogin: -1 });

    // Account lockout methods
    userSchema.methods.incLoginAttempts = function() {
      if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({
          $unset: { loginAttempts: 1, lockUntil: 1 }
        });
      }
      
      const updates = { $inc: { loginAttempts: 1 } };
      
      if (this.loginAttempts + 1 >= 5 && !this.lockUntil) {
        updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
      }
      
      return this.updateOne(updates);
    };

    userSchema.virtual('isLocked').get(function() {
      return !!(this.lockUntil && this.lockUntil > Date.now());
    });

    const User = mongoose.model('User', userSchema);

    // Enhanced Chat Session Schema
    const chatSessionSchema = new mongoose.Schema({
      userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true,
        index: true
      },
      messages: [{
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { 
          type: String, 
          required: true,
          maxlength: 10000
        },
        timestamp: { type: Date, default: Date.now },
        subject: String,
        difficulty: { type: String, enum: ['easy', 'medium', 'hard'] },
        tokens: Number
      }],
      subject: {
        type: String,
        required: true,
        maxlength: 100
      },
      sessionType: { 
        type: String, 
        enum: ['study', 'quiz', 'review', 'homework_help'], 
        default: 'study' 
      },
      duration: { type: Number, min: 0 },
      startTime: { type: Date, default: Date.now },
      endTime: Date,
      isActive: { type: Boolean, default: true },
      totalTokens: { type: Number, default: 0 },
      cost: { type: Number, default: 0 }
    }, { 
      timestamps: true,
      // Automatic cleanup of old sessions
      expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
    });

    chatSessionSchema.index({ userId: 1, createdAt: -1 });
    chatSessionSchema.index({ subject: 1 });
    chatSessionSchema.index({ sessionType: 1 });

    const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

    // Enhanced Quiz Schema
    const quizSchema = new mongoose.Schema({
      userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true,
        index: true
      },
      subject: { type: String, required: true, maxlength: 100 },
      topic: { type: String, required: true, maxlength: 200 },
      difficulty: { 
        type: String, 
        enum: ['easy', 'medium', 'hard'], 
        default: 'medium' 
      },
      questions: [{
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        question: { type: String, required: true, maxlength: 1000 },
        type: { 
          type: String, 
          enum: ['mcq', 'true_false', 'fill_blank', 'short_answer', 'matching'],
          required: true
        },
        options: {
          type: [String],
          validate: {
            validator: function(v) {
              if (this.type === 'mcq') return v.length >= 2 && v.length <= 6;
              if (this.type === 'true_false') return v.length === 2;
              return true;
            },
            message: 'Invalid options for question type'
          }
        },
        correctAnswer: { type: String, required: true },
        explanation: String,
        userAnswer: String,
        isCorrect: Boolean,
        timeSpent: { type: Number, min: 0 },
        pointsAwarded: { type: Number, default: 0 }
      }],
      score: { type: Number, min: 0, max: 100 },
      totalQuestions: { type: Number, required: true, min: 1 },
      completedAt: Date,
      timeTaken: { type: Number, min: 0 }, // in seconds
      passingScore: { type: Number, default: 70, min: 0, max: 100 },
      passed: Boolean,
      attempts: { type: Number, default: 1, min: 1 }
    }, { timestamps: true });

    quizSchema.index({ userId: 1, subject: 1 });
    quizSchema.index({ completedAt: -1 });
    quizSchema.index({ score: -1 });

    const Quiz = mongoose.model('Quiz', quizSchema);

    return { User, ChatSession, Quiz };
  }

  // Security Middleware - Enhanced
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:", "https://api.anthropic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "same-origin" }
  }));

  // Additional security middleware
  app.use(mongoSanitize()); // Prevent NoSQL injection
  app.use(hpp()); // Prevent HTTP Parameter Pollution
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    }
  }));

  // CORS with proper configuration
  const allowedOrigins = env.NODE_ENV === "production" 
    ? (env.ALLOWED_ORIGINS?.split(',') || [])
    : ["http://localhost:3000", "http://localhost:5000", "http://localhost:8080"];

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400 // 24 hours
  }));

  // Enhanced Rate Limiting with user-based limits
  const createRateLimiter = (windowMs, max, message, keyGenerator = null) => {
    return rateLimit({
      windowMs,
      max,
      message: { error: message, retryAfter: Math.ceil(windowMs / 1000) },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: keyGenerator || ((req) => {
        return req.user?.id || req.ip;
      }),
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/api/health';
      }
    });
  };

  const authLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    5,
    "Too many authentication attempts, please try again later.",
    (req) => req.ip // Always use IP for auth attempts
  );

  const chatLimiter = createRateLimiter(
    15 * 60 * 1000,
    env.NODE_ENV === 'development' ? 1000 : 50,
    "Too many chat requests, please try again later."
  );

  const apiLimiter = createRateLimiter(
    15 * 60 * 1000,
    100,
    "Too many API requests, please try again later."
  );

  const apiSlowDown = slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: env.NODE_ENV === 'development' ? 1000 : 20,
    delayMs: 100,
    maxDelayMs: 5000
  });

  // Apply rate limiting
  app.use('/api/auth', authLimiter);
  app.use('/api/chat', chatLimiter, apiSlowDown);
  app.use('/api', apiLimiter);

  // Session configuration with proper store
  const sessionConfig = {
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'studybuddy.sid',
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax'
    }
  };

  if (redis) {
    sessionConfig.store = MongoStore.create({
      client: mongoose.connection.getClient(),
      collectionName: 'sessions',
      ttl: 24 * 60 * 60 // 24 hours
    });
  }

  app.use(session(sessionConfig));

  // Body parsing with size limits
  app.use(express.json({ 
    limit: env.MAX_REQUEST_SIZE,
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ 
    extended: true, 
    limit: env.MAX_REQUEST_SIZE
  }));

  // Input sanitization middleware
  const sanitizeInput = (req, res, next) => {
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }
    next();
  };

  function sanitizeObject(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return typeof obj === 'string' ? xss(obj) : obj;
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = xss(value.trim());
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'string' ? xss(item.trim()) : item
        );
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  app.use(sanitizeInput);

  // Validation middleware
  const validate = (schema) => {
    return (req, res, next) => {
      const { error } = schema.validate(req.body);
      if (error) {
        logger.warn('Validation failed', { 
          correlationId: req.correlationId,
          error: error.details 
        });
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }
      next();
    };
  };

  // JWT Authentication middleware
  const authenticateToken = async (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        return res.status(401).json({ error: 'Access token required' });
      }

      const decoded = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid token or user inactive' });
      }

      req.user = user;
      next();
    } catch (error) {
      logger.warn('Authentication failed', { 
        correlationId: req.correlationId,
        error: error.message 
      });
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  };

  // Socket.IO setup with authentication
  const io = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Socket.IO authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        throw new Error('Authentication token required');
      }

      const decoded = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (!user || !user.isActive) {
        throw new Error('Invalid token or user inactive');
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      logger.warn('Socket authentication failed', { error: error.message });
      next(new Error('Authentication failed'));
    }
  });

  // Socket.IO event handlers
  io.on('connection', (socket) => {
    logger.info('User connected', { 
      userId: socket.userId,
      socketId: socket.id 
    });

    socket.join(`user:${socket.userId}`);

    socket.on('join_chat_session', async (sessionId) => {
      try {
        const session = await ChatSession.findById(sessionId);
        if (session && session.userId.toString() === socket.userId) {
          socket.join(`session:${sessionId}`);
          socket.emit('joined_session', { sessionId });
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    socket.on('send_message', async (data) => {
      try {
        const { sessionId, message, subject } = data;
        
        // Validate input
        if (!message || message.trim().length === 0) {
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }

        if (message.length > 10000) {
          socket.emit('error', { message: 'Message too long' });
          return;
        }

        const session = await ChatSession.findById(sessionId);
        if (!session || session.userId.toString() !== socket.userId) {
          socket.emit('error', { message: 'Session not found or unauthorized' });
          return;
        }

        // Add user message
        session.messages.push({
          role: 'user',
          content: message.trim(),
          subject: subject || session.subject,
          timestamp: new Date()
        });

        await session.save();

        // Emit to session room
        io.to(`session:${sessionId}`).emit('message_received', {
          role: 'user',
          content: message.trim(),
          timestamp: new Date()
        });

        // Get AI response (simplified - in production this would call Anthropic API)
        const aiResponse = await getAIResponse(message, session.subject, socket.user);
        
        session.messages.push({
          role: 'assistant',
          content: aiResponse,
          subject: subject || session.subject,
          timestamp: new Date()
        });

        await session.save();

        io.to(`session:${sessionId}`).emit('message_received', {
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Socket message error', { 
          userId: socket.userId,
          error: error.message 
        });
        socket.emit('error', { message: 'Failed to process message' });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('User disconnected', { 
        userId: socket.userId,
        socketId: socket.id,
        reason 
      });
    });
  });
// Add these routes to your existing server.js file after the existing chat routes (around line 800)

// Enhanced Chat History Routes
app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();
    const subject = req.query.subject?.trim();
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;

    // Build query filters
    const query = { userId: req.user._id };
    
    if (search) {
      query.$or = [
        { 'messages.content': { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (subject) {
      query.subject = { $regex: subject, $options: 'i' };
    }
    
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    // Get chat sessions with message count and last message
    const sessions = await ChatSession.aggregate([
      { $match: query },
      {
        $addFields: {
          messageCount: { $size: '$messages' },
          lastMessage: { $arrayElemAt: ['$messages', -1] },
          firstUserMessage: {
            $arrayElemAt: [
              { $filter: { input: '$messages', as: 'msg', cond: { $eq: ['$$msg.role', 'user'] } } },
              0
            ]
          }
        }
      },
      {
        $project: {
          subject: 1,
          sessionType: 1,
          startTime: 1,
          endTime: 1,
          duration: 1,
          messageCount: 1,
          createdAt: 1,
          updatedAt: 1,
          'lastMessage.content': 1,
          'lastMessage.timestamp': 1,
          'lastMessage.role': 1,
          'firstUserMessage.content': 1,
          preview: { $substr: ['$firstUserMessage.content', 0, 150] }
        }
      },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    ]);

    const total = await ChatSession.countDocuments(query);

    // Get subject suggestions for filtering
    const subjects = await ChatSession.distinct('subject', { userId: req.user._id });

    res.json({
      sessions,
      subjects: subjects.slice(0, 20), // Limit suggestions
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Chat history retrieval error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to retrieve chat history',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get detailed session with all messages
app.get('/api/chat/session/:sessionId/full', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: req.user._id
    }).select('subject sessionType messages startTime endTime duration createdAt');

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Mark messages as read (if implementing read status)
    await ChatSession.updateOne(
      { _id: sessionId },
      { $set: { lastReadAt: new Date() } }
    );

    res.json({ session });

  } catch (error) {
    logger.error('Get full session error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      sessionId: req.params.sessionId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to retrieve session',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete a chat session
app.delete('/api/chat/session/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const result = await ChatSession.deleteOne({
      _id: sessionId,
      userId: req.user._id
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    logger.info('Chat session deleted', {
      correlationId: req.correlationId,
      userId: req.user._id,
      sessionId
    });

    res.json({ message: 'Session deleted successfully' });

  } catch (error) {
    logger.error('Delete session error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      sessionId: req.params.sessionId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to delete session',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update session title/subject
app.put('/api/chat/session/:sessionId/title', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    if (!title || title.trim().length === 0 || title.length > 100) {
      return res.status(400).json({ error: 'Title must be between 1 and 100 characters' });
    }

    const session = await ChatSession.findOneAndUpdate(
      { _id: sessionId, userId: req.user._id },
      { subject: title.trim() },
      { new: true }
    ).select('subject');

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ 
      message: 'Title updated successfully',
      session: { id: session._id, subject: session.subject }
    });

  } catch (error) {
    logger.error('Update session title error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      sessionId: req.params.sessionId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to update title',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Export chat session
app.get('/api/chat/session/:sessionId/export', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const format = req.query.format || 'json'; // json, txt, md

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: req.user._id
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    let content, contentType, filename;

    switch (format) {
      case 'txt':
        content = formatSessionAsText(session);
        contentType = 'text/plain';
        filename = `chat-${session.subject.replace(/[^a-zA-Z0-9]/g, '_')}-${sessionId.slice(-6)}.txt`;
        break;
      
      case 'md':
        content = formatSessionAsMarkdown(session);
        contentType = 'text/markdown';
        filename = `chat-${session.subject.replace(/[^a-zA-Z0-9]/g, '_')}-${sessionId.slice(-6)}.md`;
        break;
      
      default:
        content = JSON.stringify({
          session: {
            id: session._id,
            subject: session.subject,
            sessionType: session.sessionType,
            startTime: session.startTime,
            endTime: session.endTime,
            duration: session.duration,
            messages: session.messages
          },
          exportedAt: new Date().toISOString()
        }, null, 2);
        contentType = 'application/json';
        filename = `chat-${session.subject.replace(/[^a-zA-Z0-9]/g, '_')}-${sessionId.slice(-6)}.json`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);

  } catch (error) {
    logger.error('Export session error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      sessionId: req.params.sessionId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to export session',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Bulk operations
app.post('/api/chat/sessions/bulk-delete', authenticateToken, async (req, res) => {
  try {
    const { sessionIds } = req.body;

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return res.status(400).json({ error: 'Session IDs array is required' });
    }

    if (sessionIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 sessions can be deleted at once' });
    }

    // Validate all session IDs
    const invalidIds = sessionIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: 'Invalid session IDs found' });
    }

    const result = await ChatSession.deleteMany({
      _id: { $in: sessionIds },
      userId: req.user._id
    });

    logger.info('Bulk delete chat sessions', {
      correlationId: req.correlationId,
      userId: req.user._id,
      requested: sessionIds.length,
      deleted: result.deletedCount
    });

    res.json({ 
      message: 'Sessions deleted successfully',
      deleted: result.deletedCount
    });

  } catch (error) {
    logger.error('Bulk delete sessions error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to delete sessions',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat statistics
app.get('/api/chat/statistics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const stats = await ChatSession.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          totalMessages: { $sum: { $size: '$messages' } },
          totalDuration: { $sum: '$duration' },
          recentSessions: {
            $sum: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 1, 0] }
          },
          subjects: { $addToSet: '$subject' }
        }
      },
      {
        $project: {
          _id: 0,
          totalSessions: 1,
          totalMessages: 1,
          totalDuration: 1,
          recentSessions: 1,
          uniqueSubjects: { $size: '$subjects' },
          averageMessagesPerSession: { 
            $round: [{ $divide: ['$totalMessages', '$totalSessions'] }, 1] 
          },
          averageDuration: { 
            $round: [{ $divide: ['$totalDuration', '$totalSessions'] }, 1] 
          }
        }
      }
    ]);

    res.json(stats[0] || {
      totalSessions: 0,
      totalMessages: 0,
      totalDuration: 0,
      recentSessions: 0,
      uniqueSubjects: 0,
      averageMessagesPerSession: 0,
      averageDuration: 0
    });

  } catch (error) {
    logger.error('Chat statistics error', {
      correlationId: req.correlationId,
      userId: req.user._id,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to retrieve statistics',
      message: env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper functions for export formatting
function formatSessionAsText(session) {
  let text = `Chat Session: ${session.subject}\n`;
  text += `Date: ${session.startTime.toLocaleString()}\n`;
  text += `Duration: ${session.duration || 'N/A'} minutes\n`;
  text += `Messages: ${session.messages.length}\n`;
  text += `\n${'='.repeat(50)}\n\n`;

  session.messages.forEach((message, index) => {
    const role = message.role === 'user' ? 'You' : 'StudyBuddy';
    const timestamp = message.timestamp.toLocaleTimeString();
    text += `[${timestamp}] ${role}:\n${message.content}\n\n`;
  });

  return text;
}

function formatSessionAsMarkdown(session) {
  let md = `# Chat Session: ${session.subject}\n\n`;
  md += `**Date:** ${session.startTime.toLocaleString()}\n`;
  md += `**Duration:** ${session.duration || 'N/A'} minutes\n`;
  md += `**Messages:** ${session.messages.length}\n\n`;
  md += `---\n\n`;

  session.messages.forEach((message, index) => {
    const role = message.role === 'user' ? '👤 **You**' : '🤖 **StudyBuddy**';
    const timestamp = message.timestamp.toLocaleTimeString();
    md += `### ${role} *(${timestamp})*\n\n${message.content}\n\n`;
  });

  return md;
}
  // Validation schemas
  const registerSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required()
      .messages({
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      }),
    profile: Joi.object({
      grade: Joi.string().valid('K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'college', 'graduate'),
      subjects: Joi.array().items(Joi.string()).max(10),
      learningGoals: Joi.array().items(Joi.string()).max(5),
      preferredLanguage: Joi.string().valid('en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko').default('en')
    })
  });

  const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  });

  const chatMessageSchema = Joi.object({
    message: Joi.string().min(1).max(10000).required(),
    subject: Joi.string().max(100),
    sessionId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    difficulty: Joi.string().valid('easy', 'medium', 'hard')
  });

  const quizCreateSchema = Joi.object({
    subject: Joi.string().min(1).max(100).required(),
    topic: Joi.string().min(1).max(200).required(),
    difficulty: Joi.string().valid('easy', 'medium', 'hard').default('medium'),
    questionCount: Joi.number().min(1).max(50).default(10)
  });

  // Utility functions
  const generateToken = (userId) => {
    return jwt.sign(
      { userId, iat: Math.floor(Date.now() / 1000) },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );
  };

  const hashPassword = async (password) => {
    return await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  };

  const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
  };

  // AI Response function (placeholder - replace with actual Anthropic API call)
  const getAIResponse = async (message, subject, user) => {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.ANTHROPIC_API_KEY}`,
          'x-api-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `As a study buddy for a ${user.profile.grade || 'student'} studying ${subject}, help with: ${message}`
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`API response ${response.status}`);
      }

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      logger.error('AI API error', { error: error.message });
      return "I'm having trouble connecting right now. Please try again in a moment.";
    }
  };

  // Health check endpoints
  app.get('/health', (req, res) => {
    res.status(200).json({ 
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  app.get('/api/health', async (req, res) => {
    try {
      // Check database connection
      await mongoose.connection.db.admin().ping();
      
      // Check Redis connection if available
      let redisStatus = 'not_configured';
      if (redis) {
        try {
          await redis.ping();
          redisStatus = 'connected';
        } catch (error) {
          redisStatus = 'error';
        }
      }

      res.status(200).json({
        status: 'OK',
        checks: {
          database: 'connected',
          redis: redisStatus,
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
          },
          uptime: process.uptime()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      res.status(503).json({
        status: 'ERROR',
        error: 'Service unavailable',
        timestamp: new Date().toISOString()
      });
    }
  });

  // API Routes

  // Authentication Routes
  app.post('/api/auth/register', validate(registerSchema), async (req, res) => {
    try {
      const { username, email, password, profile } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          field: existingUser.email === email ? 'email' : 'username'
        });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user
      const user = new User({
        username,
        email,
        password: hashedPassword,
        profile: profile || {}
      });

      await user.save();

      // Generate token
      const token = generateToken(user._id);

      logger.info('User registered', { 
        correlationId: req.correlationId,
        userId: user._id,
        username,
        email 
      });

      res.status(201).json({
        message: 'Registration successful',
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          profile: user.profile,
          stats: user.stats
        }
      });

    } catch (error) {
      logger.error('Registration error', { 
        correlationId: req.correlationId,
        error: error.message 
      });
      
      if (error.code === 11000) {
        const field = Object.keys(error.keyValue)[0];
        return res.status(409).json({
          error: 'User already exists',
          field
        });
      }

      res.status(500).json({
        error: 'Registration failed',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.post('/api/auth/login', validate(loginSchema), async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user with password field
      const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');

      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Check if account is locked
      if (user.isLocked) {
        return res.status(423).json({ 
          error: 'Account temporarily locked due to too many failed attempts',
          lockUntil: user.lockUntil
        });
      }

      // Verify password
      const isValidPassword = await comparePassword(password, user.password);

      if (!isValidPassword) {
        await user.incLoginAttempts();
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Reset login attempts and update last login
      await User.updateOne(
        { _id: user._id },
        {
          $unset: { loginAttempts: 1, lockUntil: 1 },
          $set: { lastLogin: new Date() }
        }
      );

      // Generate token
      const token = generateToken(user._id);

      logger.info('User logged in', { 
        correlationId: req.correlationId,
        userId: user._id,
        email 
      });

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          profile: user.profile,
          stats: user.stats
        }
      });

    } catch (error) {
      logger.error('Login error', { 
        correlationId: req.correlationId,
        error: error.message 
      });
      
      res.status(500).json({
        error: 'Login failed',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.post('/api/auth/logout', authenticateToken, (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        logger.error('Logout error', { 
          correlationId: req.correlationId,
          error: err.message 
        });
        return res.status(500).json({ error: 'Logout failed' });
      }
      
      res.clearCookie('studybuddy.sid');
      res.json({ message: 'Logout successful' });
    });
  });

  app.get('/api/auth/profile', authenticateToken, (req, res) => {
    res.json({
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        profile: req.user.profile,
        stats: req.user.stats,
        achievements: req.user.achievements,
        studyProgress: req.user.studyProgress
      }
    });
  });

  app.put('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
      const allowedUpdates = ['profile', 'weakAreas'];
      const updates = {};
      
      for (const field of allowedUpdates) {
        if (req.body[field]) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid updates provided' });
      }

      const user = await User.findByIdAndUpdate(
        req.user._id,
        updates,
        { new: true, runValidators: true }
      );

      res.json({
        message: 'Profile updated successfully',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          profile: user.profile,
          stats: user.stats
        }
      });

    } catch (error) {
      logger.error('Profile update error', { 
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message 
      });
      
      res.status(500).json({
        error: 'Profile update failed',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Chat Routes
  app.post('/api/chat/session', authenticateToken, async (req, res) => {
    try {
      const { subject, sessionType = 'study' } = req.body;

      if (!subject || subject.trim().length === 0) {
        return res.status(400).json({ error: 'Subject is required' });
      }

      const session = new ChatSession({
        userId: req.user._id,
        subject: subject.trim(),
        sessionType,
        messages: []
      });

      await session.save();

      logger.info('Chat session created', {
        correlationId: req.correlationId,
        userId: req.user._id,
        sessionId: session._id,
        subject
      });

      res.status(201).json({
        message: 'Session created successfully',
        session: {
          id: session._id,
          subject: session.subject,
          sessionType: session.sessionType,
          startTime: session.startTime
        }
      });

    } catch (error) {
      logger.error('Chat session creation error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to create session',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.get('/api/chat/sessions', authenticateToken, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (page - 1) * limit;

      const sessions = await ChatSession.find({ userId: req.user._id })
        .select('subject sessionType startTime endTime duration')
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit);

      const total = await ChatSession.countDocuments({ userId: req.user._id });

      res.json({
        sessions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Get sessions error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to retrieve sessions',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.get('/api/chat/session/:sessionId', authenticateToken, async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = await ChatSession.findOne({
        _id: sessionId,
        userId: req.user._id
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ session });

    } catch (error) {
      logger.error('Get session error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        sessionId: req.params.sessionId,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to retrieve session',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.post('/api/chat/message', authenticateToken, validate(chatMessageSchema), async (req, res) => {
    try {
      const { sessionId, message, subject } = req.body;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = await ChatSession.findOne({
        _id: sessionId,
        userId: req.user._id
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Add user message
      session.messages.push({
        role: 'user',
        content: message.trim(),
        subject: subject || session.subject,
        timestamp: new Date()
      });

      // Get AI response
      const aiResponse = await getAIResponse(message, session.subject, req.user);
      
      session.messages.push({
        role: 'assistant',
        content: aiResponse,
        subject: subject || session.subject,
        timestamp: new Date()
      });

      await session.save();

      // Update user stats
      await User.updateOne(
        { _id: req.user._id },
        {
          $inc: { 
            'stats.questionsAsked': 1,
            'stats.totalStudyTime': 1 // Simplified - in real app, track actual time
          }
        }
      );

      logger.info('Chat message processed', {
        correlationId: req.correlationId,
        userId: req.user._id,
        sessionId: session._id
      });

      res.json({
        message: 'Message sent successfully',
        response: {
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Chat message error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to process message',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Quiz Routes
  app.post('/api/quiz/create', authenticateToken, validate(quizCreateSchema), async (req, res) => {
    try {
      const { subject, topic, difficulty, questionCount } = req.body;

      // Generate quiz questions (simplified - in production, use AI to generate)
      const questions = generateQuizQuestions(subject, topic, difficulty, questionCount);

      const quiz = new Quiz({
        userId: req.user._id,
        subject,
        topic,
        difficulty,
        questions,
        totalQuestions: questions.length
      });

      await quiz.save();

      logger.info('Quiz created', {
        correlationId: req.correlationId,
        userId: req.user._id,
        quizId: quiz._id,
        subject,
        topic
      });

      res.status(201).json({
        message: 'Quiz created successfully',
        quiz: {
          id: quiz._id,
          subject: quiz.subject,
          topic: quiz.topic,
          difficulty: quiz.difficulty,
          totalQuestions: quiz.totalQuestions,
          questions: quiz.questions.map(q => ({
            id: q._id,
            question: q.question,
            type: q.type,
            options: q.options
          }))
        }
      });

    } catch (error) {
      logger.error('Quiz creation error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to create quiz',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.post('/api/quiz/:quizId/submit', authenticateToken, async (req, res) => {
    try {
      const { quizId } = req.params;
      const { answers } = req.body;

      if (!mongoose.Types.ObjectId.isValid(quizId)) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
      }

      if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'Answers must be an array' });
      }

      const quiz = await Quiz.findOne({
        _id: quizId,
        userId: req.user._id
      });

      if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
      }

      if (quiz.completedAt) {
        return res.status(400).json({ error: 'Quiz already completed' });
      }

      // Score the quiz
      let correctAnswers = 0;
      const scoredQuestions = quiz.questions.map((question, index) => {
        const userAnswer = answers[index];
        const isCorrect = question.correctAnswer.toLowerCase() === userAnswer?.toLowerCase();
        
        if (isCorrect) correctAnswers++;
        
        return {
          ...question.toObject(),
          userAnswer,
          isCorrect,
          pointsAwarded: isCorrect ? 10 : 0
        };
      });

      const score = Math.round((correctAnswers / quiz.totalQuestions) * 100);
      const passed = score >= quiz.passingScore;

      // Update quiz
      quiz.questions = scoredQuestions;
      quiz.score = score;
      quiz.completedAt = new Date();
      quiz.passed = passed;
      quiz.timeTaken = Math.floor((Date.now() - quiz.createdAt) / 1000);

      await quiz.save();

      // Update user stats
      const xpEarned = score + (passed ? 50 : 0);
      await User.updateOne(
        { _id: req.user._id },
        {
          $inc: {
            'stats.quizzesCompleted': 1,
            'stats.xpPoints': xpEarned
          }
        }
      );

      logger.info('Quiz submitted', {
        correlationId: req.correlationId,
        userId: req.user._id,
        quizId: quiz._id,
        score,
        passed
      });

      res.json({
        message: 'Quiz submitted successfully',
        result: {
          score,
          passed,
          correctAnswers,
          totalQuestions: quiz.totalQuestions,
          xpEarned,
          timeTaken: quiz.timeTaken,
          questions: scoredQuestions
        }
      });

    } catch (error) {
      logger.error('Quiz submission error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        quizId: req.params.quizId,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to submit quiz',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  app.get('/api/quiz/history', authenticateToken, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (page - 1) * limit;

      const quizzes = await Quiz.find({ 
        userId: req.user._id,
        completedAt: { $exists: true }
      })
        .select('subject topic difficulty score totalQuestions passed completedAt timeTaken')
        .sort({ completedAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Quiz.countDocuments({ 
        userId: req.user._id,
        completedAt: { $exists: true }
      });

      res.json({
        quizzes,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Quiz history error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to retrieve quiz history',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Analytics Routes
  app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
      const userId = req.user._id;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Get recent activity
      const [recentSessions, recentQuizzes, studyStats] = await Promise.all([
        ChatSession.find({ 
          userId, 
          createdAt: { $gte: thirtyDaysAgo } 
        }).select('subject sessionType createdAt duration'),
        
        Quiz.find({ 
          userId, 
          completedAt: { $gte: thirtyDaysAgo, $exists: true } 
        }).select('subject score completedAt passed'),
        
        User.findById(userId).select('stats studyProgress')
      ]);

      // Calculate streaks and achievements
      const dailyActivity = calculateDailyActivity(recentSessions, recentQuizzes);
      const subjectProgress = calculateSubjectProgress(studyStats.studyProgress);

      res.json({
        stats: studyStats.stats,
        dailyActivity,
        subjectProgress,
        recentSessions: recentSessions.slice(0, 10),
        recentQuizzes: recentQuizzes.slice(0, 10)
      });

    } catch (error) {
      logger.error('Analytics dashboard error', {
        correlationId: req.correlationId,
        userId: req.user._id,
        error: error.message
      });
      
      res.status(500).json({
        error: 'Failed to retrieve analytics',
        message: env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Helper functions
  function generateQuizQuestions(subject, topic, difficulty, count) {
    // Simplified question generation - in production, use AI
    const questionTypes = ['mcq', 'true_false', 'fill_blank'];
    const questions = [];

    for (let i = 0; i < count; i++) {
      const type = questionTypes[Math.floor(Math.random() * questionTypes.length)];
      let question = {
        question: `Sample ${difficulty} question ${i + 1} about ${topic} in ${subject}`,
        type,
        correctAnswer: 'Sample Answer',
        explanation: 'This is a sample explanation.'
      };

      if (type === 'mcq') {
        question.options = ['Sample Answer', 'Wrong Answer 1', 'Wrong Answer 2', 'Wrong Answer 3'];
      } else if (type === 'true_false') {
        question.options = ['True', 'False'];
        question.correctAnswer = 'True';
      }

      questions.push(question);
    }

    return questions;
  }

  function calculateDailyActivity(sessions, quizzes) {
    const days = {};
    
    sessions.forEach(session => {
      const day = session.createdAt.toISOString().split('T')[0];
      if (!days[day]) days[day] = { sessions: 0, quizzes: 0, totalTime: 0 };
      days[day].sessions++;
      days[day].totalTime += session.duration || 0;
    });

    quizzes.forEach(quiz => {
      const day = quiz.completedAt.toISOString().split('T')[0];
      if (!days[day]) days[day] = { sessions: 0, quizzes: 0, totalTime: 0 };
      days[day].quizzes++;
    });

    return Object.entries(days).map(([date, data]) => ({
      date,
      ...data
    }));
  }

  function calculateSubjectProgress(studyProgress) {
    return studyProgress.map(progress => ({
      subject: progress.subject,
      averageCompletion: progress.completionPercentage,
      lastStudied: progress.lastStudied,
      difficulty: progress.difficultyLevel
    }));
  }

  // Static file serving with proper headers
  app.use(express.static(path.join(__dirname, "public"), {
    maxAge: env.NODE_ENV === 'production' ? '1y' : 0,
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));

  // Error handling middleware - Enhanced
  app.use((err, req, res, next) => {
    // Log the error
    logger.error('Unhandled error:', {
      correlationId: req.correlationId,
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      userId: req.user?.id
    });

    // Don't expose error details in production
    if (env.NODE_ENV === 'production') {
      return res.status(500).json({
        error: 'Internal server error',
        correlationId: req.correlationId
      });
    }

    res.status(err.status || 500).json({
      error: err.message,
      stack: err.stack,
      correlationId: req.correlationId
    });
  });

  // 404 handler for API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ 
      error: 'API endpoint not found',
      path: req.path,
      method: req.method
    });
  });

  // Handle SPA routing - Enhanced
  app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    
    // Check if index.html exists
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ 
        error: 'Application not found',
        message: 'Frontend build not found. Please build the React app first.'
      });
    }
    
    res.sendFile(indexPath);
  });

  // Cleanup and maintenance jobs
  cron.schedule('0 2 * * *', async () => {
    try {
      // Clean up old sessions
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await ChatSession.deleteMany({ 
        createdAt: { $lt: thirtyDaysAgo },
        isActive: false 
      });

      // Clean up incomplete quizzes older than 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await Quiz.deleteMany({
        createdAt: { $lt: oneDayAgo },
        completedAt: { $exists: false }
      });

      logger.info('Cleanup job completed');
    } catch (error) {
      logger.error('Cleanup job failed', { error: error.message });
    }
  });

  // Graceful shutdown - Enhanced
  const gracefulShutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);
    
    server.close(() => {
      logger.info('HTTP server closed');
      
      // Close database connection
      mongoose.connection.close().then(() => {
        logger.info('MongoDB connection closed');
        
        // Close Redis connection
        if (redis) {
          redis.disconnect();
          logger.info('Redis connection closed');
        }
        
        process.exit(0);
      });
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { reason, promise });
  });

  // Start server
  const PORT = env.PORT;
  server.listen(PORT, () => {
    logger.info(`🚀 StudyBuddy Enhanced Server running at http://localhost:${PORT}`);
    logger.info(`📡 API endpoints available at http://localhost:${PORT}/api/`);
    logger.info(`🎮 Socket.IO enabled for real-time features`);
    logger.info(`💾 Database: ${env.MONGODB_URI.replace(/\/\/.*@/, '//***:***@')}`);
    logger.info(`💻 Environment: ${env.NODE_ENV}`);
    logger.info(`🔒 Security: Enhanced with rate limiting, input validation, and monitoring`);
    logger.info(`📊 Features: Authentication, Analytics, Quizzes, Real-time Chat, Achievements`);
    logger.info(`🔧 Process ID: ${process.pid}`);
    logger.info(`💡 Health Check: http://localhost:${PORT}/health`);
    
    // Log memory usage
    const memUsage = process.memoryUsage();
    logger.info(`💾 Memory Usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
  });

  return { app, server, io, logger };
}