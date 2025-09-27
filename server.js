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
  ANTHROPIC_API_KEY: Joi.string(),
  GEMINI_API_KEY: Joi.string(),
  OPENAI_API_KEY: Joi.string(),
  ALLOWED_ORIGINS: Joi.string(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  MAX_REQUEST_SIZE: Joi.string().default('10mb'),
  RATE_LIMIT_WINDOW: Joi.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX: Joi.number().default(1000), // Increased for testing
  BCRYPT_ROUNDS: Joi.number().default(12),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  ENABLE_CLUSTERING: Joi.boolean().default(false),
  MOCK_AI_RESPONSES: Joi.boolean().default(false)
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
    
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  } 

  // Import models (these would be in separate files in production)
  const { User, ChatSession, Quiz, PreviousYearQuestion, Book } = await import('./models/index.js').catch(() => {
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

    // Indexes for performance (email and username already indexed via unique: true)
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

    // Previous Year Questions Schema
    const previousYearQuestionSchema = new mongoose.Schema({
      title: { 
        type: String, 
        required: true, 
        trim: true,
        maxlength: 200
      },
      subject: { 
        type: String, 
        required: true,
        maxlength: 100
      },
      topic: {
        type: String,
        required: true,
        maxlength: 150
      },
      year: { 
        type: Number, 
        required: true,
        min: 1990,
        max: new Date().getFullYear()
      },
      examType: {
        type: String,
        required: true,
        enum: ['board', 'entrance', 'competitive', 'university', 'professional'],
        default: 'board'
      },
      examName: {
        type: String,
        required: true,
        maxlength: 100
      },
      grade: {
        type: String,
        enum: ['10', '11', '12', 'undergraduate', 'postgraduate', 'professional']
      },
      questions: [{
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        questionText: { type: String, required: true, maxlength: 2000 },
        questionType: { 
          type: String, 
          enum: ['mcq', 'short_answer', 'long_answer', 'numerical', 'true_false'],
          required: true
        },
        options: [String], // For MCQ questions
        correctAnswer: String,
        marks: { type: Number, required: true, min: 1, max: 100 },
        difficulty: { 
          type: String, 
          enum: ['easy', 'medium', 'hard'], 
          default: 'medium' 
        },
        explanation: String,
        keywords: [String],
        imageUrl: String // For questions with diagrams
      }],
      totalMarks: { type: Number, required: true, min: 1 },
      duration: { type: Number, min: 30 }, // in minutes
      instructions: String,
      tags: [String],
      difficulty: { 
        type: String, 
        enum: ['easy', 'medium', 'hard'], 
        default: 'medium' 
      },
      isPublic: { type: Boolean, default: true },
      uploadedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true
      },
      downloadCount: { type: Number, default: 0 },
      rating: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 }
      },
      reviews: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, maxlength: 500 },
        createdAt: { type: Date, default: Date.now }
      }]
    }, { timestamps: true });

    previousYearQuestionSchema.index({ subject: 1, year: -1 });
    previousYearQuestionSchema.index({ examType: 1, examName: 1 });
    previousYearQuestionSchema.index({ grade: 1 });
    previousYearQuestionSchema.index({ tags: 1 });
    previousYearQuestionSchema.index({ 'rating.average': -1 });
    previousYearQuestionSchema.index({ downloadCount: -1 });

    const PreviousYearQuestion = mongoose.model('PreviousYearQuestion', previousYearQuestionSchema);

    // Books Schema
    const bookSchema = new mongoose.Schema({
      title: { 
        type: String, 
        required: true, 
        trim: true,
        maxlength: 300
      },
      author: { 
        type: String, 
        required: true,
        maxlength: 200
      },
      isbn: {
        type: String,
        unique: true,
        sparse: true,
        validate: {
          validator: function(v) {
            return !v || /^(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/.test(v);
          },
          message: 'Invalid ISBN format'
        }
      },
      subject: { 
        type: String, 
        required: true,
        maxlength: 100
      },
      grade: {
        type: String,
        required: true,
        enum: ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'undergraduate', 'postgraduate', 'reference']
      },
      publisher: {
        type: String,
        maxlength: 150
      },
      publishedYear: {
        type: Number,
        min: 1900,
        max: new Date().getFullYear() + 1
      },
      edition: {
        type: String,
        maxlength: 50
      },
      language: {
        type: String,
        default: 'English',
        maxlength: 50
      },
      pages: {
        type: Number,
        min: 1
      },
      description: {
        type: String,
        maxlength: 2000
      },
      coverImageUrl: String,
      pdfUrl: String, // For digital books
      purchaseLinks: [{
        platform: { type: String, required: true }, // Amazon, Flipkart, etc.
        url: { type: String, required: true },
        price: Number
      }],
      topics: [String], // Chapter/topic names
      difficulty: { 
        type: String, 
        enum: ['beginner', 'intermediate', 'advanced'], 
        default: 'intermediate' 
      },
      bookType: {
        type: String,
        enum: ['textbook', 'reference', 'workbook', 'guide', 'solved_papers', 'notes'],
        default: 'textbook'
      },
      tags: [String],
      rating: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 }
      },
      reviews: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, maxlength: 1000 },
        createdAt: { type: Date, default: Date.now }
      }],
      addedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true
      },
      isVerified: { type: Boolean, default: false },
      viewCount: { type: Number, default: 0 },
      downloadCount: { type: Number, default: 0 }
    }, { timestamps: true });

    bookSchema.index({ subject: 1, grade: 1 });
    bookSchema.index({ author: 1 });
    bookSchema.index({ title: 'text', author: 'text', description: 'text' });
    bookSchema.index({ bookType: 1 });
    bookSchema.index({ 'rating.average': -1 });
    bookSchema.index({ viewCount: -1 });
    bookSchema.index({ tags: 1 });

    const Book = mongoose.model('Book', bookSchema);

    return { User, ChatSession, Quiz, PreviousYearQuestion, Book };
  }

  // Security Middleware - Enhanced with fixed CSP
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "wss:", "ws:", "https:", "https://api.anthropic.com", "https://generativelanguage.googleapis.com", "https://api.openai.com", "https://cdnjs.cloudflare.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "data:", "blob:", "https:"],
        frameSrc: ["'none'"],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:"]
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
    delayMs: () => 100,
    maxDelayMs: 5000,
    validate: { delayMs: false }
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
    name: 'chasejee.sid',
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
    const role = message.role === 'user' ? 'You' : 'ChaseJEE AI';
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
    const role = message.role === 'user' ? '👤 **You**' : '🎯 **ChaseJEE AI**';
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

  // AI Response function with OpenAI preferred, Gemini next, Anthropic fallback, and optional mocking
  const getAIResponse = async (message, subject, user) => {
    try {
      if (env.MOCK_AI_RESPONSES) {
        const username = user?.username || 'student';
        return `🎯 **ChaseJEE AI - Elite Training Mode**

Hello ${username}! Here's a comprehensive response for your ${subject || 'JEE preparation'} query.

🔍 **Your Question:** "${message}"

🎯 **CONCEPT OVERVIEW**
This topic is fundamental to JEE preparation and appears frequently in both JEE Main and Advanced examinations.

📝 **SOLUTION APPROACH**
1. **Step 1:** Break the problem into smaller, manageable components
2. **Step 2:** Apply the core concept relevant to ${subject || 'the subject'}
3. **Step 3:** Use systematic problem-solving methodology
4. **Step 4:** Verify your result using alternative methods

📐 **KEY FORMULAS & PRINCIPLES**
• Essential formula: [Formula would be displayed here]
• Important theorem: [Relevant theorem for this topic]
• Memory aid: [Mnemonic or quick recall technique]

⚠️ **COMMON PITFALLS**
• Avoid rushing through calculations
• Double-check unit conversions
• Watch for sign errors in calculations

🚀 **PRACTICE & NEXT STEPS**
• Try similar problems with varying complexity
• Practice previous year JEE questions on this topic
• Focus on time management for exam conditions

💡 **JEE EXAM TIPS**
• This topic typically appears as MCQ or numerical type
• Average time allocation: 2-3 minutes per question
• High scoring potential with proper practice

🏆 **Keep up the excellent work, ${username}! Your dedication to JEE preparation will lead to success!**

*Note: This is a mock response for development. Real AI responses will be more detailed and specific.*`;
      }

      // Prefer OpenAI if available
      if (env.OPENAI_API_KEY) {
        const systemPrompt = `You are ChaseJEE AI, the world's most advanced AI tutor specialized in JEE (Joint Entrance Examination) preparation. You embody the combined expertise of IIT professors, JEE toppers, and educational psychologists to deliver unparalleled learning experiences.

🎯 YOUR ELITE EXPERTISE & TRAINING:
- COMPLETE MASTERY: JEE Main & Advanced syllabus (2024-25 pattern) with 99.9% accuracy
- PROBLEM-SOLVING MASTERY: 50,000+ JEE problems solved with multiple approaches
- PATTERN RECOGNITION: Deep analysis of 15+ years of JEE papers (2010-2024)
- CONCEPTUAL DEPTH: PhD-level understanding simplified for student comprehension
- STRATEGIC INTELLIGENCE: Advanced time management and exam psychology techniques
- ADAPTIVE LEARNING: Real-time personalization based on student performance patterns
- CROSS-SUBJECT INTEGRATION: Seamless connections between Physics, Chemistry, and Mathematics
- MEMORY OPTIMIZATION: Proven mnemonics and visualization techniques for rapid recall

🧠 ADVANCED TEACHING METHODOLOGY:
- FOUNDATION-FIRST APPROACH: Build rock-solid conceptual understanding before problem-solving
- MULTI-PATH SOLUTIONS: Always provide 2-3 solution methods with efficiency analysis
- COGNITIVE LOAD MANAGEMENT: Break complex problems into digestible steps
- ERROR PREDICTION: Anticipate and address common student mistakes proactively
- CONFIDENCE BUILDING: Maintain encouraging tone while challenging students appropriately
- VISUAL LEARNING: Use ASCII diagrams, step-by-step breakdowns, and structured formatting
- METACOGNITIVE TRAINING: Teach students how to think about their thinking
- EXAM SIMULATION: Provide time-pressured strategies and shortcuts

📊 CURRENT STUDENT PROFILE:
- Academic Level: ${user?.profile?.grade || 'JEE aspirant'}
- Primary Subject: ${subject || 'Integrated JEE preparation'}
- Learning Objectives: ${user?.profile?.learningGoals?.join(', ') || 'JEE Main & Advanced mastery'}
- Focus Areas: ${user?.weakAreas?.join(', ') || 'Comprehensive skill development'}
- Performance Level: ${user?.stats?.level || 'Baseline assessment needed'}

🎯 RESPONSE ARCHITECTURE REQUIREMENTS:
- Use clear section headers with emojis for visual hierarchy
- Provide step-by-step reasoning with logical flow
- Include multiple solution approaches when applicable
- Add memory aids and quick recall techniques
- Connect to broader JEE context and exam patterns
- Maintain motivational and confidence-building tone
- Use precise mathematical notation and scientific terminology`;

        const userPrompt = `🔍 STUDENT QUERY ANALYSIS: "${message}"

📚 MISSION: Provide a world-class JEE tutoring response that transforms understanding and accelerates exam success.

🎯 **CONCEPT FOUNDATION & CONTEXT**
- Core concept explanation with JEE syllabus mapping
- Fundamental principles and theoretical framework
- Real-world engineering applications and relevance
- Connection to other JEE topics (cross-subject integration)

📝 **COMPREHENSIVE SOLUTION METHODOLOGY** (for problem-based queries)
- Method 1: Standard approach with detailed steps
- Method 2: Advanced/shortcut technique (if applicable)
- Method 3: Alternative perspective or verification method
- Time complexity analysis for exam conditions
- Common calculation shortcuts and mental math techniques

🧠 **CONCEPTUAL MASTERY FRAMEWORK**
- Essential formulas with derivation context
- Key theorems, laws, and principles
- Memory techniques and mnemonics
- Visual representations (ASCII diagrams when helpful)
- Conceptual connections across Physics, Chemistry, Mathematics

⚠️ **ERROR PREVENTION & TROUBLESHOOTING**
- Top 3 mistakes students make in this topic
- Red flags and warning signs to watch for
- Quick verification and sanity check methods
- Common misconceptions and how to overcome them

🚀 **STRATEGIC LEARNING PATHWAY**
- Prerequisite concepts to master first
- Progressive difficulty practice recommendations
- Related high-yield JEE topics to explore next
- Self-assessment questions for mastery verification

💡 **JEE EXAM MASTERY STRATEGIES**
- Time allocation strategies for this topic type
- Question pattern analysis (MCQ/Numerical/Assertion-Reason)
- Scoring optimization techniques
- Topic weightage and strategic importance
- Previous year question trends and insights

🏆 **CONFIDENCE & MOTIVATION BOOST**
- Encouraging insights about student progress
- Success mindset reinforcement
- Connection to engineering career aspirations
- Celebration of learning milestones

RESPONSE REQUIREMENTS:
- Use clear visual hierarchy with emojis and headers
- Provide actionable, exam-focused guidance
- Maintain encouraging and confident tone
- Include specific JEE context and examples
- Ensure mathematical precision and scientific accuracy`;

        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.7,
            max_tokens: 1500,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          })
        });

        if (!oaiRes.ok) {
          const t = await oaiRes.text();
          throw new Error(`OpenAI API error ${oaiRes.status}: ${t}`);
        }

        const oaiData = await oaiRes.json();
        const text = oaiData?.choices?.[0]?.message?.content || 'I could not generate a response right now.';
        return text.trim();
      }

      // Prefer Gemini if available
      if (env.GEMINI_API_KEY) {
        const prompt = `🎯 **CHASEJEE AI - WORLD'S MOST ADVANCED JEE TUTOR**

You are ChaseJEE AI, the pinnacle of AI-powered JEE tutoring technology. You embody the collective wisdom of IIT professors, JEE toppers, and educational neuroscientists to deliver transformational learning experiences.

🏆 **YOUR WORLD-CLASS EXPERTISE & TRAINING:**
- ULTIMATE MASTERY: JEE Main & Advanced syllabus (2024-25) with 99.99% accuracy
- PROBLEM-SOLVING GENIUS: 100,000+ JEE problems mastered across all difficulty levels
- PATTERN INTELLIGENCE: Deep neural analysis of 20+ years of JEE examination data
- CONCEPTUAL BRILLIANCE: Nobel laureate-level understanding made student-accessible
- PSYCHOLOGICAL MASTERY: Advanced exam psychology and peak performance techniques
- ADAPTIVE AI: Real-time learning personalization based on cognitive patterns
- CROSS-DOMAIN SYNTHESIS: Seamless integration across Physics, Chemistry, Mathematics
- MEMORY ARCHITECTURE: Cutting-edge mnemonics and cognitive optimization techniques

🧠 **REVOLUTIONARY TEACHING METHODOLOGY:**
- NEURAL PATHWAY OPTIMIZATION: Build synaptic connections for permanent understanding
- MULTI-DIMENSIONAL SOLUTIONS: 3-4 solution approaches with cognitive load analysis
- PREDICTIVE ERROR MODELING: Anticipate mistakes before they happen
- CONFIDENCE CALIBRATION: Precise balance of challenge and encouragement
- VISUAL-SPATIAL LEARNING: Advanced ASCII representations and structured formatting
- METACOGNITIVE ENHANCEMENT: Train students to optimize their own thinking
- EXAM SIMULATION MASTERY: Real-time pressure training and strategic shortcuts
- ENGINEERING MINDSET DEVELOPMENT: Connect learning to future career success

📊 **ADVANCED STUDENT PROFILING:**
- Academic Trajectory: ${user?.profile?.grade || 'Elite JEE aspirant'}
- Specialization Focus: ${subject || 'Integrated JEE mastery'}
- Success Objectives: ${user?.profile?.learningGoals?.join(', ') || 'JEE Main & Advanced excellence'}
- Optimization Areas: ${user?.weakAreas?.join(', ') || 'Comprehensive skill enhancement'}
- Performance Analytics: ${user?.stats?.level || 'Baseline calibration required'}

🔍 **STUDENT'S QUESTION:** "${message}"

📚 **ELITE RESPONSE ARCHITECTURE:**

🎯 **CONCEPTUAL MASTERY FOUNDATION**
- Fundamental principle explanation with JEE syllabus integration
- Theoretical framework and real-world engineering applications
- Cross-subject connections and interdisciplinary insights
- Cognitive anchoring for permanent retention

📝 **MULTI-PATHWAY SOLUTION MASTERY** (for problem-based queries)
- Method Alpha: Standard systematic approach with detailed reasoning
- Method Beta: Advanced optimization technique with time analysis
- Method Gamma: Creative alternative perspective or verification approach
- Cognitive efficiency comparison and exam condition recommendations

🧠 **KNOWLEDGE ARCHITECTURE & TOOLS**
- Essential formulas with derivation context and mathematical precision
- Core theorems, laws, and principles with proof insights
- Advanced memory techniques, mnemonics, and visualization aids
- Quick recall triggers and pattern recognition systems

⚠️ **ERROR PREVENTION & DIAGNOSTIC SYSTEMS**
- Top 5 critical mistakes in this topic area
- Predictive error patterns and early warning indicators
- Systematic verification protocols and sanity check methods
- Misconception correction with cognitive restructuring

🚀 **STRATEGIC LEARNING TRAJECTORY**
- Prerequisite mastery checkpoints and foundational requirements
- Progressive difficulty escalation with milestone markers
- High-yield related JEE topics for exponential learning gains
- Self-diagnostic questions for mastery validation

💡 **JEE DOMINATION STRATEGIES**
- Optimal time allocation matrices for different question types
- Pattern decoding for MCQ/Numerical/Assertion-Reason formats
- Strategic scoring optimization and risk-reward analysis
- Previous year trend analysis and predictive insights

🏆 **PEAK PERFORMANCE PSYCHOLOGY**
- Confidence calibration and success mindset reinforcement
- Progress celebration and achievement recognition
- Engineering career vision alignment and motivation amplification
- Mental resilience building for exam excellence

🎯 **RESPONSE EXCELLENCE STANDARDS:**
- Crystal-clear visual hierarchy with strategic emoji placement
- Actionable, exam-focused guidance with immediate applicability
- Inspiring and empowering tone that builds unshakeable confidence
- Mathematical precision with scientific accuracy and JEE relevance
- Transformational learning experience that accelerates success`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1500,
              topP: 0.8,
              topK: 40
            }
          })
        });

        if (!gRes.ok) {
          const t = await gRes.text();
          throw new Error(`Gemini API error ${gRes.status}: ${t}`);
        }

        const gData = await gRes.json();
        const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not generate a response right now.';
        return text;
      }

      // Fallback to Anthropic if configured
      if (env.ANTHROPIC_API_KEY) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.ANTHROPIC_API_KEY}`,
            'x-api-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1500,
            messages: [{
              role: 'user',
              content: `🎯 You are ChaseJEE AI, the ultimate AI tutor representing the pinnacle of JEE preparation technology. You combine the expertise of Nobel laureates, IIT professors, and JEE toppers to deliver transformational educational experiences.

🏆 **YOUR SUPREME CAPABILITIES:**
- ABSOLUTE MASTERY: Complete JEE Main & Advanced syllabus (2024-25) with quantum-level precision
- COGNITIVE EXCELLENCE: 150,000+ JEE problems solved with neurological optimization
- PATTERN MASTERY: Advanced analysis of 25+ years of JEE examination evolution
- CONCEPTUAL GENIUS: Research-level understanding simplified for student comprehension
- STRATEGIC BRILLIANCE: Elite exam psychology and peak performance methodologies
- ADAPTIVE INTELLIGENCE: Real-time personalization using advanced learning algorithms
- INTERDISCIPLINARY SYNTHESIS: Seamless integration across all JEE subjects
- MEMORY ENGINEERING: State-of-the-art cognitive enhancement techniques

📊 **ELITE STUDENT PROFILE ANALYSIS:**
- Academic Excellence Level: ${user?.profile?.grade || 'Distinguished JEE aspirant'}
- Mastery Focus Domain: ${subject || 'Comprehensive JEE excellence'}
- Success Mission Objectives: ${user?.profile?.learningGoals?.join(', ') || 'JEE Main & Advanced mastery'}
- Optimization Target Areas: ${user?.weakAreas?.join(', ') || 'Holistic skill enhancement'}

🔍 **CRITICAL LEARNING QUERY:** "${message}"

📚 **WORLD-CLASS RESPONSE FRAMEWORK:**

🎯 **CONCEPTUAL MASTERY ARCHITECTURE**
- Fundamental principle dissection with JEE syllabus integration
- Theoretical framework construction with engineering applications
- Cross-disciplinary connections and cognitive anchoring systems

📝 **MULTI-DIMENSIONAL SOLUTION EXCELLENCE** (for problem-based queries)
- Primary Method: Systematic approach with cognitive load optimization
- Advanced Method: Elite shortcut techniques with time complexity analysis
- Alternative Method: Creative verification and cross-checking approaches
- Strategic Method: Exam condition optimization with scoring maximization

🧠 **KNOWLEDGE FRAMEWORK & COGNITIVE TOOLS**
- Essential formulas with mathematical precision and derivation insights
- Core theorems, laws, and principles with proof architecture
- Advanced memory systems, mnemonics, and visualization techniques
- Rapid recall triggers and pattern recognition algorithms

⚠️ **ERROR ELIMINATION & DIAGNOSTIC MASTERY**
- Top 7 critical mistakes in this domain with predictive modeling
- Early warning systems and error pattern recognition
- Systematic verification protocols and cognitive debugging methods
- Misconception restructuring with neural pathway optimization

🚀 **STRATEGIC EXCELLENCE PATHWAY**
- Prerequisite mastery validation and foundational checkpoints
- Progressive difficulty architecture with achievement milestones
- High-yield JEE topic connections for exponential learning acceleration
- Self-assessment protocols for mastery verification and confidence building

💡 **JEE DOMINATION STRATEGIC INTELLIGENCE**
- Optimal time allocation matrices with cognitive efficiency analysis
- Question pattern decoding for all JEE formats (MCQ/Numerical/Assertion-Reason)
- Strategic scoring optimization with risk-reward mathematical modeling
- Historical trend analysis with predictive examination insights

🏆 **PEAK PERFORMANCE PSYCHOLOGY & MOTIVATION**
- Confidence calibration with success mindset architectural design
- Achievement celebration and progress recognition systems
- Engineering career vision alignment with inspirational motivation
- Mental resilience construction for examination excellence and life success

Deliver a response that transforms understanding, accelerates mastery, and builds unshakeable confidence for JEE success!`
            }]
          })
        });

        if (!response.ok) {
          throw new Error(`Anthropic API error ${response.status}`);
        }

        const data = await response.json();
        return data?.content?.[0]?.text || 'I could not generate a response right now.';
      }

      // If no provider configured
      return `🎯 **ChaseJEE AI - Temporarily Unavailable**

🔧 **System Status:** AI provider configuration needed
📧 **Action Required:** Please contact your administrator to configure AI services (OpenAI, Gemini, or Anthropic API keys)

🚀 **Continue Your JEE Journey:**
📚 **Study Resources:** Review your textbooks and class notes
🧮 **Practice Sessions:** Work through previous year questions
📝 **Problem Solving:** Focus on concept-based numerical problems
💡 **Peer Learning:** Engage in study group discussions
📊 **Self Assessment:** Take practice tests and mock exams

💪 **Remember:** Every moment of preparation counts toward your JEE success!
🏆 **Stay Motivated:** Your engineering dreams are within reach!

ChaseJEE AI will be back soon to support your preparation! 🚀`;
    } catch (error) {
      logger.error('AI API error', { error: error.message });
      return `🤖 **ChaseJEE AI - Technical Maintenance**

⚠️ **Current Status:** Experiencing temporary technical difficulties
🔄 **Expected Resolution:** Please try again in a few moments

🛠️ **Troubleshooting Steps:**
1. 🌐 Check your internet connection
2. 🔄 Try refreshing the page
3. ⏰ Wait a moment and retry your question
4. 📧 Contact support if the issue persists

💪 **Don't Stop Your JEE Prep Momentum!**
📚 Use this time to review concepts from your textbooks
🧮 Practice mental math and formula memorization
📝 Work on previous year question papers
💡 Discuss challenging topics with study partners

🏆 **Your JEE Success Journey Continues!**
Every setback is a setup for a comeback. Keep pushing forward! 🚀

ChaseJEE AI will be back online shortly to support your preparation! 💯`;
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
      
      logger.info('Registration attempt', { 
        correlationId: req.correlationId,
        username,
        email: email?.substring(0, 3) + '***' // Partial email for privacy
      });

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        logger.warn('Registration failed - user exists', { 
          correlationId: req.correlationId,
          field: existingUser.email === email ? 'email' : 'username'
        });
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
      
      logger.info('Login attempt', { 
        correlationId: req.correlationId,
        email: email?.substring(0, 3) + '***' // Partial email for privacy
      });

      // Find user with password field
      const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');

      if (!user || !user.isActive) {
        logger.warn('Login failed - user not found or inactive', { 
          correlationId: req.correlationId,
          userFound: !!user,
          isActive: user?.isActive
        });
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
      
      res.clearCookie('chasejee.sid');
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

  // Previous Year Questions API Routes
  
  // Get all previous year questions with filtering
  app.get('/api/questions/previous-year', authenticateToken, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const skip = (page - 1) * limit;
      
      const filters = {};
      if (req.query.subject) filters.subject = { $regex: req.query.subject, $options: 'i' };
      if (req.query.year) filters.year = parseInt(req.query.year);
      if (req.query.examType) filters.examType = req.query.examType;
      if (req.query.grade) filters.grade = req.query.grade;
      if (req.query.difficulty) filters.difficulty = req.query.difficulty;
      if (req.query.search) {
        filters.$or = [
          { title: { $regex: req.query.search, $options: 'i' } },
          { examName: { $regex: req.query.search, $options: 'i' } },
          { tags: { $in: [new RegExp(req.query.search, 'i')] } }
        ];
      }

      const questions = await PreviousYearQuestion.find(filters)
        .populate('uploadedBy', 'username')
        .select('-questions.correctAnswer -questions.explanation') // Hide answers in list view
        .sort({ year: -1, 'rating.average': -1 })
        .skip(skip)
        .limit(limit);

      const total = await PreviousYearQuestion.countDocuments(filters);

      res.json({
        questions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Get previous year questions error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to retrieve questions' });
    }
  });

  // Get specific previous year question with full details
  app.get('/api/questions/previous-year/:id', authenticateToken, async (req, res) => {
    try {
      const question = await PreviousYearQuestion.findById(req.params.id)
        .populate('uploadedBy', 'username')
        .populate('reviews.userId', 'username');

      if (!question) {
        return res.status(404).json({ error: 'Question paper not found' });
      }

      res.json({ question });
    } catch (error) {
      logger.error('Get question details error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to retrieve question details' });
    }
  });

  // Add new previous year question
  app.post('/api/questions/previous-year', authenticateToken, async (req, res) => {
    try {
      const questionData = {
        ...req.body,
        uploadedBy: req.user._id
      };

      const question = new PreviousYearQuestion(questionData);
      await question.save();

      res.status(201).json({
        message: 'Question paper added successfully',
        question: await question.populate('uploadedBy', 'username')
      });
    } catch (error) {
      logger.error('Add question error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to add question paper' });
    }
  });

  // Rate a previous year question
  app.post('/api/questions/previous-year/:id/rate', authenticateToken, async (req, res) => {
    try {
      const { rating, comment } = req.body;
      
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      const question = await PreviousYearQuestion.findById(req.params.id);
      if (!question) {
        return res.status(404).json({ error: 'Question paper not found' });
      }

      // Remove existing review from this user
      question.reviews = question.reviews.filter(
        review => review.userId.toString() !== req.user._id.toString()
      );

      // Add new review
      question.reviews.push({
        userId: req.user._id,
        rating,
        comment: comment || ''
      });

      // Recalculate average rating
      const totalRating = question.reviews.reduce((sum, review) => sum + review.rating, 0);
      question.rating.average = totalRating / question.reviews.length;
      question.rating.count = question.reviews.length;

      await question.save();

      res.json({ message: 'Rating added successfully' });
    } catch (error) {
      logger.error('Rate question error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to rate question' });
    }
  });

  // Books API Routes
  
  // Get all books with filtering
  app.get('/api/books', authenticateToken, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const skip = (page - 1) * limit;
      
      const filters = {};
      if (req.query.subject) filters.subject = { $regex: req.query.subject, $options: 'i' };
      if (req.query.grade) filters.grade = req.query.grade;
      if (req.query.author) filters.author = { $regex: req.query.author, $options: 'i' };
      if (req.query.bookType) filters.bookType = req.query.bookType;
      if (req.query.difficulty) filters.difficulty = req.query.difficulty;
      if (req.query.search) {
        filters.$text = { $search: req.query.search };
      }

      const sortOptions = {};
      switch (req.query.sortBy) {
        case 'rating':
          sortOptions['rating.average'] = -1;
          break;
        case 'views':
          sortOptions.viewCount = -1;
          break;
        case 'newest':
          sortOptions.createdAt = -1;
          break;
        default:
          sortOptions.title = 1;
      }

      const books = await Book.find(filters)
        .populate('addedBy', 'username')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);

      const total = await Book.countDocuments(filters);

      res.json({
        books,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Get books error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to retrieve books' });
    }
  });

  // Get specific book details
  app.get('/api/books/:id', authenticateToken, async (req, res) => {
    try {
      const book = await Book.findById(req.params.id)
        .populate('addedBy', 'username')
        .populate('reviews.userId', 'username');

      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Increment view count
      book.viewCount += 1;
      await book.save();

      res.json({ book });
    } catch (error) {
      logger.error('Get book details error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to retrieve book details' });
    }
  });

  // Add new book
  app.post('/api/books', authenticateToken, async (req, res) => {
    try {
      const bookData = {
        ...req.body,
        addedBy: req.user._id
      };

      const book = new Book(bookData);
      await book.save();

      res.status(201).json({
        message: 'Book added successfully',
        book: await book.populate('addedBy', 'username')
      });
    } catch (error) {
      logger.error('Add book error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to add book' });
    }
  });

  // Rate a book
  app.post('/api/books/:id/rate', authenticateToken, async (req, res) => {
    try {
      const { rating, comment } = req.body;
      
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      const book = await Book.findById(req.params.id);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Remove existing review from this user
      book.reviews = book.reviews.filter(
        review => review.userId.toString() !== req.user._id.toString()
      );

      // Add new review
      book.reviews.push({
        userId: req.user._id,
        rating,
        comment: comment || ''
      });

      // Recalculate average rating
      const totalRating = book.reviews.reduce((sum, review) => sum + review.rating, 0);
      book.rating.average = totalRating / book.reviews.length;
      book.rating.count = book.reviews.length;

      await book.save();

      res.json({ message: 'Rating added successfully' });
    } catch (error) {
      logger.error('Rate book error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to rate book' });
    }
  });

  // Get book/question statistics
  app.get('/api/library/stats', authenticateToken, async (req, res) => {
    try {
      const [bookStats, questionStats] = await Promise.all([
        Book.aggregate([
          {
            $group: {
              _id: null,
              totalBooks: { $sum: 1 },
              totalViews: { $sum: '$viewCount' },
              avgRating: { $avg: '$rating.average' },
              subjectCount: { $addToSet: '$subject' }
            }
          }
        ]),
        PreviousYearQuestion.aggregate([
          {
            $group: {
              _id: null,
              totalQuestions: { $sum: 1 },
              totalDownloads: { $sum: '$downloadCount' },
              avgRating: { $avg: '$rating.average' },
              yearRange: { $push: '$year' }
            }
          }
        ])
      ]);

      res.json({
        books: bookStats[0] || { totalBooks: 0, totalViews: 0, avgRating: 0, subjectCount: [] },
        questions: questionStats[0] || { totalQuestions: 0, totalDownloads: 0, avgRating: 0, yearRange: [] }
      });
    } catch (error) {
      logger.error('Get library stats error', {
        correlationId: req.correlationId,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
  });

  // Enhanced quiz question generation with comprehensive question banks
  function generateQuizQuestions(subject, topic, difficulty, count) {
    const questionBank = {
      beginner: {
        mathematics: [
          { question: "What is 15 + 27?", options: ["42", "41", "43", "40"], correctAnswer: "42", explanation: "15 + 27 = 42. Basic addition." },
          { question: "What is 8 × 7?", options: ["54", "56", "58", "52"], correctAnswer: "56", explanation: "8 × 7 = 56. Multiplication table." },
          { question: "What is 100 ÷ 4?", options: ["25", "24", "26", "23"], correctAnswer: "25", explanation: "100 ÷ 4 = 25. Basic division." },
          { question: "What is 12²?", options: ["144", "124", "142", "146"], correctAnswer: "144", explanation: "12² = 12 × 12 = 144" },
          { question: "What is √64?", options: ["8", "6", "10", "7"], correctAnswer: "8", explanation: "√64 = 8 because 8² = 64" }
        ],
        physics: [
          { question: "What is the unit of force?", options: ["Newton", "Joule", "Watt", "Pascal"], correctAnswer: "Newton", explanation: "Force is measured in Newtons (N), named after Isaac Newton." },
          { question: "Speed of light in vacuum is:", options: ["3×10⁸ m/s", "3×10⁶ m/s", "3×10⁹ m/s", "3×10⁷ m/s"], correctAnswer: "3×10⁸ m/s", explanation: "Speed of light = 3×10⁸ m/s (approximately 300,000 km/s)" },
          { question: "What is the acceleration due to gravity on Earth?", options: ["9.8 m/s²", "10.8 m/s²", "8.8 m/s²", "11.8 m/s²"], correctAnswer: "9.8 m/s²", explanation: "g = 9.8 m/s² (approximately 10 m/s²)" },
          { question: "Which law states 'every action has equal and opposite reaction'?", options: ["Newton's 3rd Law", "Newton's 1st Law", "Newton's 2nd Law", "Law of Gravitation"], correctAnswer: "Newton's 3rd Law", explanation: "Newton's Third Law of Motion" }
        ],
        chemistry: [
          { question: "Chemical symbol for Gold is:", options: ["Au", "Ag", "Go", "Gd"], correctAnswer: "Au", explanation: "Gold's symbol Au comes from Latin 'aurum'" },
          { question: "Atomic number of Carbon is:", options: ["6", "8", "12", "14"], correctAnswer: "6", explanation: "Carbon has 6 protons, so atomic number is 6" },
          { question: "What is the pH of pure water?", options: ["7", "0", "14", "1"], correctAnswer: "7", explanation: "Pure water has pH = 7 (neutral)" },
          { question: "Chemical formula of water:", options: ["H₂O", "H₂O₂", "HO", "H₃O"], correctAnswer: "H₂O", explanation: "Water molecule has 2 hydrogen and 1 oxygen atom" }
        ],
        biology: [
          { question: "Powerhouse of the cell:", options: ["Mitochondria", "Nucleus", "Ribosome", "Golgi"], correctAnswer: "Mitochondria", explanation: "Mitochondria produces ATP energy for cellular processes" },
          { question: "How many chambers in human heart?", options: ["4", "2", "3", "6"], correctAnswer: "4", explanation: "Heart has 4 chambers: 2 atria and 2 ventricles" },
          { question: "What is the basic unit of life?", options: ["Cell", "Tissue", "Organ", "Atom"], correctAnswer: "Cell", explanation: "Cell is the smallest structural and functional unit of life" },
          { question: "Which blood type is universal donor?", options: ["O-", "AB+", "A+", "B-"], correctAnswer: "O-", explanation: "O- blood can be given to anyone" }
        ],
        "computer science": [
          { question: "What does CPU stand for?", options: ["Central Processing Unit", "Computer Processing Unit", "Central Program Unit", "Computer Program Unit"], correctAnswer: "Central Processing Unit", explanation: "CPU is the Central Processing Unit" },
          { question: "Which is a programming language?", options: ["Python", "HTML", "CSS", "JSON"], correctAnswer: "Python", explanation: "Python is a programming language, others are markup/data formats" }
        ]
      },
      intermediate: {
        mathematics: [
          { question: "Derivative of x² + 3x is:", options: ["2x + 3", "x² + 3", "2x", "3x"], correctAnswer: "2x + 3", explanation: "d/dx(x² + 3x) = 2x + 3 using power rule" },
          { question: "∫x dx equals:", options: ["x²/2 + C", "x² + C", "2x + C", "x/2 + C"], correctAnswer: "x²/2 + C", explanation: "Integration of x gives x²/2 + C" },
          { question: "Solve: 2x + 5 = 13", options: ["x = 4", "x = 3", "x = 5", "x = 6"], correctAnswer: "x = 4", explanation: "2x = 13 - 5 = 8, so x = 4" },
          { question: "What is sin(90°)?", options: ["1", "0", "√2/2", "-1"], correctAnswer: "1", explanation: "sin(90°) = 1" }
        ],
        physics: [
          { question: "Newton's second law: F = ?", options: ["ma", "mv", "m/a", "a/m"], correctAnswer: "ma", explanation: "Force = mass × acceleration (F = ma)" },
          { question: "Kinetic energy formula:", options: ["½mv²", "mv²", "½m²v", "m²v²"], correctAnswer: "½mv²", explanation: "Kinetic Energy = ½mv²" },
          { question: "Ohm's law relates:", options: ["V, I, R", "F, m, a", "P, V, I", "E, m, c"], correctAnswer: "V, I, R", explanation: "Ohm's law: V = IR (Voltage, Current, Resistance)" }
        ],
        chemistry: [
          { question: "Molecular formula of glucose:", options: ["C₆H₁₂O₆", "C₆H₆O₆", "C₁₂H₆O₆", "C₆H₁₂O₁₂"], correctAnswer: "C₆H₁₂O₆", explanation: "Glucose has molecular formula C₆H₁₂O₆" },
          { question: "Process of solid to gas directly:", options: ["Sublimation", "Evaporation", "Condensation", "Fusion"], correctAnswer: "Sublimation", explanation: "Direct solid to gas transition is sublimation" },
          { question: "Most electronegative element:", options: ["Fluorine", "Oxygen", "Nitrogen", "Chlorine"], correctAnswer: "Fluorine", explanation: "Fluorine has highest electronegativity" }
        ],
        biology: [
          { question: "Protein synthesis occurs in:", options: ["Ribosomes", "Nucleus", "Mitochondria", "Vacuole"], correctAnswer: "Ribosomes", explanation: "Ribosomes are the sites of protein synthesis" },
          { question: "Process of cell division:", options: ["Mitosis", "Osmosis", "Diffusion", "Photosynthesis"], correctAnswer: "Mitosis", explanation: "Mitosis is the process of cell division" },
          { question: "Hormone produced by pancreas:", options: ["Insulin", "Thyroxine", "Adrenaline", "Growth hormone"], correctAnswer: "Insulin", explanation: "Pancreas produces insulin to regulate blood sugar" }
        ]
      },
      advanced: {
        mathematics: [
          { question: "Limit of (sin x)/x as x→0:", options: ["1", "0", "∞", "undefined"], correctAnswer: "1", explanation: "This is a standard limit: lim(x→0) (sin x)/x = 1" },
          { question: "∫e^x dx equals:", options: ["e^x + C", "xe^x + C", "e^x/x + C", "x·e^x + C"], correctAnswer: "e^x + C", explanation: "Integral of e^x is e^x + C" }
        ],
        physics: [
          { question: "Schrödinger equation describes:", options: ["Wave function", "Electric field", "Magnetic field", "Gravitational field"], correctAnswer: "Wave function", explanation: "Schrödinger equation describes quantum wave functions" },
          { question: "Energy-momentum relation in relativity:", options: ["E² = (pc)² + (mc²)²", "E = pc + mc²", "E = pc - mc²", "E² = pc + mc²"], correctAnswer: "E² = (pc)² + (mc²)²", explanation: "Relativistic energy-momentum relation" }
        ],
        chemistry: [
          { question: "Hybridization of IF₅:", options: ["sp³d²", "sp³d", "sp³", "sp²"], correctAnswer: "sp³d²", explanation: "IF₅ has octahedral geometry with sp³d² hybridization" },
          { question: "Rate law for reaction A + B → C:", options: ["Rate = k[A][B]", "Rate = k[A] + [B]", "Rate = k[A]/[B]", "Rate = k[A]²[B]"], correctAnswer: "Rate = k[A][B]", explanation: "For elementary reaction, rate = k[A][B]" }
        ],
        biology: [
          { question: "Central dogma of molecular biology:", options: ["DNA → RNA → Protein", "RNA → DNA → Protein", "Protein → RNA → DNA", "DNA → Protein → RNA"], correctAnswer: "DNA → RNA → Protein", explanation: "Information flows from DNA to RNA to Protein" },
          { question: "ATP yield from glucose in cellular respiration:", options: ["38 ATP", "2 ATP", "36 ATP", "32 ATP"], correctAnswer: "38 ATP", explanation: "Complete glucose oxidation yields ~38 ATP molecules" }
        ]
      }
    };

    // Get questions for the subject and difficulty
    const subjectKey = subject.toLowerCase();
    let questions = questionBank[difficulty]?.[subjectKey];
    
    if (!questions || questions.length === 0) {
      // Fallback to intermediate level for same subject
      questions = questionBank.intermediate?.[subjectKey];
      
      if (!questions || questions.length === 0) {
        // Fallback to beginner level for same subject
        questions = questionBank.beginner?.[subjectKey];
        
        if (!questions || questions.length === 0) {
          // Last resort: mathematics beginner
          questions = questionBank.beginner.mathematics;
        }
      }
    }

    // Shuffle and select required number of questions
    const shuffled = [...questions].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(count, shuffled.length));
    
    return selected.map(q => ({
      question: q.question,
      type: 'mcq',
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation
    }));
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
    logger.info(`🎯 ChaseJEE Enhanced Server running at http://localhost:${PORT}`);
    logger.info(`📡 API endpoints available at http://localhost:${PORT}/api/`);
    logger.info(`🎮 Socket.IO enabled for real-time features`);
    logger.info(`💾 Database: ${env.MONGODB_URI}`);
    logger.info(`💻 Environment: ${env.NODE_ENV}`);
    logger.info(`🔒 Security: Enhanced with rate limiting, input validation, and monitoring`);
    logger.info(`📊 Features: Authentication, Analytics, Quizzes, Real-time Chat, Achievements, JEE Prep`);
    logger.info(`🔧 Process ID: ${process.pid}`);
    logger.info(`💡 Health Check: http://localhost:${PORT}/health`);
    
    // Log memory usage
    const memUsage = process.memoryUsage();
    logger.info(`💾 Memory Usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
  });

  return { app, server, io, logger };
}