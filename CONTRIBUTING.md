# 🤝 Contributing to ChaseJEE

Thank you for your interest in contributing to ChaseJEE! We welcome contributions from developers, educators, and JEE aspirants who want to help improve this AI-powered learning platform.

## 🎯 How to Contribute

### 🐛 Reporting Bugs
- Use the [GitHub Issues](https://github.com/yourusername/chasejee-ai-enhanced/issues) page
- Search existing issues before creating a new one
- Include detailed steps to reproduce the bug
- Provide system information (OS, browser, Node.js version)
- Add screenshots or error logs if applicable

### 💡 Suggesting Features
- Open a feature request issue with the `enhancement` label
- Describe the feature and its benefits for JEE preparation
- Explain how it aligns with ChaseJEE's educational goals
- Consider implementation complexity and user experience

### 🔧 Code Contributions

#### Getting Started
1. **Fork the repository**
   ```bash
   git clone https://github.com/yourusername/chasejee-ai-enhanced.git
   cd chasejee-ai-enhanced
   ```

2. **Set up development environment**
   ```bash
   npm install
   cp .env.example .env
   # Fill in your API keys and configuration
   ```

3. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

#### Development Guidelines

**Code Style**
- Follow the existing ESLint configuration
- Use meaningful variable and function names
- Add comments for complex logic
- Maintain consistent indentation (2 spaces)

**Commit Messages**
Use conventional commit format:
```
type(scope): description

feat(quiz): add adaptive difficulty progression
fix(auth): resolve JWT token expiration issue
docs(readme): update installation instructions
style(ui): improve mobile responsiveness
```

**Testing**
- Write tests for new features
- Ensure all existing tests pass
- Aim for >80% code coverage
- Test on multiple browsers and devices

**Documentation**
- Update README.md for new features
- Add JSDoc comments for functions
- Update API documentation
- Include usage examples

#### Pull Request Process

1. **Before submitting**
   - Run `npm test` to ensure all tests pass
   - Run `npm run lint` to check code style
   - Update documentation as needed
   - Test your changes thoroughly

2. **Pull Request Template**
   ```markdown
   ## 📝 Description
   Brief description of changes

   ## 🎯 Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## 🧪 Testing
   - [ ] Tests added/updated
   - [ ] All tests passing
   - [ ] Manual testing completed

   ## 📋 Checklist
   - [ ] Code follows style guidelines
   - [ ] Self-review completed
   - [ ] Documentation updated
   - [ ] No breaking changes
   ```

3. **Review Process**
   - Maintainers will review your PR
   - Address feedback promptly
   - Keep discussions respectful and constructive
   - Be patient during the review process

## 🏗️ Development Setup

### Prerequisites
- Node.js 18+ and npm 8+
- MongoDB 4.4+
- Git for version control

### Environment Variables
```env
# Required for development
MONGODB_URI=mongodb://localhost:27017/chasejee-dev
JWT_SECRET=your-dev-jwt-secret
SESSION_SECRET=your-dev-session-secret

# AI API Keys (at least one required)
OPENAI_API_KEY=your-openai-key
GOOGLE_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-claude-key
```

### Running the Application
```bash
# Development mode with auto-restart
npm run dev

# Run tests
npm test

# Run linting
npm run lint

# Format code
npm run format
```

## 🎓 Educational Focus

ChaseJEE is specifically designed for JEE preparation. When contributing:

### 📚 Content Guidelines
- Ensure accuracy of mathematical and scientific content
- Align with JEE Main and Advanced syllabi
- Use appropriate difficulty progression
- Include detailed explanations and solutions
- Cite reliable sources for factual information

### 🎯 User Experience
- Prioritize learning effectiveness
- Design for mobile and desktop users
- Consider different learning styles
- Maintain accessibility standards
- Focus on JEE aspirant needs

### 🤖 AI Integration
- Ensure AI responses are educationally sound
- Test with various question types
- Maintain response quality across providers
- Handle edge cases gracefully
- Preserve context and learning flow

## 🏷️ Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or improvement
- `documentation` - Documentation needs
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed
- `priority: high` - Critical issues
- `ai` - AI-related features
- `quiz` - Quiz system improvements
- `analytics` - Study analytics features
- `ui/ux` - User interface improvements

## 🌟 Recognition

Contributors will be:
- Listed in the README.md contributors section
- Mentioned in release notes for significant contributions
- Invited to join the ChaseJEE community Discord
- Considered for maintainer roles based on contributions

## 📞 Getting Help

- **Discord**: Join our [ChaseJEE Community](https://discord.gg/chasejee)
- **Email**: developers@chasejee.com
- **Issues**: Use GitHub Issues for technical questions
- **Discussions**: Use GitHub Discussions for general questions

## 📋 Code of Conduct

### Our Pledge
We are committed to making participation in ChaseJEE a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards
- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

### Enforcement
Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project maintainers at conduct@chasejee.com.

---

**Thank you for contributing to ChaseJEE! Together, we're building the future of JEE preparation. 🚀**
