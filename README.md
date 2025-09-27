# 🎯 ChaseJEE - AI-Enhanced JEE Preparation Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=flat&logo=mongodb&logoColor=white)](https://www.mongodb.com/)

**ChaseJEE** is an advanced AI-powered learning platform specifically designed for JEE (Joint Entrance Examination) preparation. It combines cutting-edge artificial intelligence with comprehensive study tools to provide an unparalleled learning experience for engineering aspirants.

## 🚀 Features

### 🤖 AI-Powered Learning
- **Multi-AI Integration**: OpenAI GPT-4o-mini, Google Gemini 1.5 Flash, and Anthropic Claude
- **JEE-Specialized Responses**: AI tutors trained specifically for JEE Main & Advanced
- **Real-time Chat**: Interactive AI assistance with instant responses
- **Speech-to-Text**: Voice input support for natural conversation
- **Smart Context**: AI remembers your learning progress and adapts responses

### 📚 Comprehensive Study Tools
- **Adaptive Quiz System**: Progressive difficulty from beginner to JEE Advanced level
- **Subject-Specific Questions**: Mathematics, Physics, Chemistry, Biology, Computer Science
- **Previous Year Questions**: Extensive database of JEE papers with solutions
- **Books Database**: Curated collection of JEE preparation books with ratings
- **Study Timer**: Pomodoro technique with analytics and streak tracking

### 📊 Advanced Analytics
- **Study Pattern Analysis**: Daily, weekly, and monthly progress tracking
- **Performance Metrics**: Subject-wise accuracy and improvement trends
- **AI-Powered Recommendations**: Personalized study suggestions based on performance
- **Goal Tracking**: Set and monitor study targets with visual progress indicators
- **Export Analytics**: Download comprehensive study reports

### 🎮 Gamification & Wellness
- **Achievement System**: Unlock badges and rewards for study milestones
- **Study Streaks**: Maintain consistency with daily study tracking
- **Relaxation Game**: 2048-style puzzle game with time limits for healthy breaks
- **XP System**: Earn experience points for various learning activities
- **Leaderboards**: Compare progress with other JEE aspirants

### 🔐 Security & Performance
- **JWT Authentication**: Secure user sessions with token-based auth
- **Rate Limiting**: Protection against API abuse
- **Data Encryption**: Secure storage of user data and progress
- **Real-time Updates**: Socket.IO for instant notifications and updates
- **PWA Support**: Progressive Web App for mobile-like experience

## 🛠️ Technology Stack

### Backend
- **Node.js** (v18+) - Runtime environment
- **Express.js** - Web application framework
- **MongoDB** - Database for user data and content
- **Socket.IO** - Real-time communication
- **JWT** - Authentication and authorization
- **Winston** - Logging and monitoring

### Frontend
- **Vanilla JavaScript** - Core functionality
- **Chart.js** - Analytics visualizations
- **Font Awesome** - Icons and UI elements
- **CSS3** - Modern styling with glassmorphism effects
- **Web Speech API** - Voice input support

### AI Integration
- **OpenAI API** - GPT-4o-mini for primary AI responses
- **Google Gemini** - 1.5 Flash model for enhanced responses
- **Anthropic Claude** - Additional AI provider for reliability

## 📋 Prerequisites

Before running ChaseJEE, ensure you have:

- **Node.js** (v18.0.0 or higher)
- **MongoDB** (v4.4 or higher)
- **npm** (v8.0.0 or higher)
- **Git** for version control

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/chasejee-ai-enhanced.git
   cd chasejee-ai-enhanced
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   
   # Database
   MONGODB_URI=mongodb://localhost:27017/chasejee
   
   # Authentication
   JWT_SECRET=your-super-secret-jwt-key-here
   SESSION_SECRET=your-session-secret-here
   
   # AI API Keys
   OPENAI_API_KEY=your-openai-api-key
   GOOGLE_API_KEY=your-google-gemini-api-key
   ANTHROPIC_API_KEY=your-anthropic-api-key
   
   # Email Configuration (Optional)
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   ```

4. **Start MongoDB**
   ```bash
   # On Ubuntu/Debian
   sudo systemctl start mongod
   
   # On macOS with Homebrew
   brew services start mongodb-community
   
   # On Windows
   net start MongoDB
   ```

5. **Run the application**
   ```bash
   # Development mode with auto-restart
   npm run dev
   
   # Production mode
   npm start
   ```

6. **Access the application**
   Open your browser and navigate to `http://localhost:5000`

## 🎯 Usage Guide

### Getting Started
1. **Register**: Create your ChaseJEE account with email verification
2. **Profile Setup**: Complete your profile with JEE preparation details
3. **AI Chat**: Start asking questions to your AI tutor
4. **Take Quizzes**: Test your knowledge with adaptive quizzes
5. **Track Progress**: Monitor your study analytics and achievements

### AI Chat Features
- Ask subject-specific questions (Math, Physics, Chemistry, Biology, CS)
- Get step-by-step solutions with detailed explanations
- Receive JEE exam strategies and tips
- Use voice input for natural conversation
- Export chat sessions for offline review

### Quiz System
- **Adaptive Difficulty**: Questions get harder as you improve
- **Subject Selection**: Focus on specific subjects
- **Detailed Explanations**: Learn from mistakes with comprehensive solutions
- **Progress Tracking**: Monitor accuracy and improvement trends

### Study Analytics
- **Time Tracking**: Automatic study session monitoring
- **Performance Analysis**: Subject-wise accuracy and trends
- **Goal Setting**: Set daily, weekly, and monthly targets
- **Recommendations**: AI-powered study suggestions

## 🔧 Configuration

### AI Providers Configuration
ChaseJEE supports multiple AI providers for enhanced reliability:

```javascript
// In server.js - AI Provider Priority
const AI_PROVIDERS = [
  'openai',    // Primary: GPT-4o-mini
  'gemini',    // Secondary: Gemini 1.5 Flash
  'anthropic'  // Fallback: Claude
];
```

### Database Configuration
```javascript
// MongoDB connection with options
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};
```

## 📊 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/profile` - Get user profile

### Quiz Endpoints
- `POST /api/quiz/create` - Create new quiz
- `POST /api/quiz/:id/submit` - Submit quiz answers
- `GET /api/quiz/history` - Get quiz history

### Analytics Endpoints
- `GET /api/analytics/dashboard` - Get dashboard data
- `POST /api/analytics/study-session` - Log study session
- `GET /api/analytics/export` - Export analytics data

## 🧪 Testing

Run the test suite:
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --testNamePattern="Quiz System"
```

## 🚀 Deployment

### Production Deployment
1. **Environment Setup**
   ```bash
   NODE_ENV=production
   PORT=80
   MONGODB_URI=mongodb://your-production-db
   ```

2. **Build and Start**
   ```bash
   npm run build
   npm start
   ```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

## 🤝 Contributing

We welcome contributions to ChaseJEE! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit your changes**
   ```bash
   git commit -m 'Add amazing feature'
   ```
4. **Push to the branch**
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request**

### Development Guidelines
- Follow ESLint configuration
- Write tests for new features
- Update documentation
- Maintain code quality standards

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OpenAI** for GPT-4o-mini API
- **Google** for Gemini 1.5 Flash API
- **Anthropic** for Claude API
- **MongoDB** for database solutions
- **Node.js** community for excellent packages
- **JEE aspirants** for feedback and suggestions

## 📞 Support

- **Email**: support@chasejee.com
- **Documentation**: [docs.chasejee.com](https://docs.chasejee.com)
- **Issues**: [GitHub Issues](https://github.com/yourusername/chasejee-ai-enhanced/issues)
- **Discord**: [ChaseJEE Community](https://discord.gg/chasejee)

## 🗺️ Roadmap

### Upcoming Features
- [ ] Mobile app (React Native)
- [ ] Offline mode support
- [ ] Video lecture integration
- [ ] Peer-to-peer study groups
- [ ] Advanced analytics dashboard
- [ ] Custom study plans
- [ ] Mock test series
- [ ] Performance predictions

---

**Made with ❤️ for JEE aspirants by the ChaseJEE Team**

*Empowering the next generation of engineers through AI-powered education*
