// StudyBuddy AI - Complete Enhanced Learning Platform
// Combined and optimized version with all features

// === GLOBAL VARIABLES ===
let currentUser = null;
let authToken = null;
let socket = null;
let studyTimer = null;
let timerInterval = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let currentQuiz = null;
let currentQuestionIndex = 0;
let studySession = null;
let inMemoryStorage = {}; // Browser-compatible storage replacement
let draftTimeout = null;

// === STORAGE SYSTEM ===
// Unified storage system that works in all environments
let currentChatSessionId = null;
let chatHistory = {
  sessions: [],
  currentPage: 1,
  totalPages: 1,
  loading: false,
  selectedSessions: new Set(),
  filters: {
    search: '',
    subject: '',
    dateFrom: '',
    dateTo: ''
  }
};


function setStorageItem(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
    inMemoryStorage[key] = value;
  } catch (e) {
    inMemoryStorage[key] = value;
  }
}

function getStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      const item = localStorage.getItem(key);
      if (item !== null) return item;
    }
  } catch (e) {
    // Fall back to memory storage
  }
  return inMemoryStorage[key] || null;
}

function removeStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch (e) {
    // Silent fail for localStorage
  }
  delete inMemoryStorage[key];
}

// Add this to your initializeApp function (around line 50, after other initializations)
// Initialize chat history
setTimeout(() => {
  initializeChatHistory();
  addHistoryQuickAction();
}, 1500);

// Replace your existing sendMessage function with this enhanced version
// NOTE: This is the backend-connected sendMessage (keep this one)
async function sendMessage() {
  const input = document.getElementById('userInput');
  const sendButton = document.getElementById('sendButton');
  const message = input.value.trim();
  
  if (!message || !authToken) return;

  // Create session if none exists
  if (!currentChatSessionId) {
    try {
      const sessionResponse = await fetch('/api/chat/session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: extractSubjectFromMessage(message) || 'General Study',
          sessionType: 'study'
        })
      });

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        currentChatSessionId = sessionData.session.id;
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      // Fall back to original behavior if backend not ready
    }
  }

  // Disable input and show loading
  input.disabled = true;
  if (sendButton) sendButton.disabled = true;
  const sendIcon = document.getElementById('sendIcon');
  const sendLoading = document.getElementById('sendLoading');
  if (sendIcon) sendIcon.style.display = 'none';
  if (sendLoading) sendLoading.style.display = 'flex';

  // Add user message
  addMessage(message, true);
  input.value = '';
  input.style.height = 'auto';
  
  // Clear draft
  removeStorageItem('studyBuddyDraft');

  // Show typing indicator
  showTyping();

  try {
    let response;
    
    if (currentChatSessionId) {
      // Send to backend session
      const apiResponse = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: currentChatSessionId,
          message: message,
          subject: extractSubjectFromMessage(message)
        })
      });

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        response = data.response.content;
      } else {
        throw new Error('Backend request failed');
      }
    } else {
      // Fall back to original generation
      response = generateEnhancedResponse(message);
    }

    hideTyping();
    addMessage(response, false);
    
    // Update user stats
    if (currentUser) {
      currentUser.stats.questionsAsked++;
      currentUser.stats.xpPoints += Math.floor(5 * calculateStreakBonus());
      updateUserInterface();
      updateStoredUser();
      checkLevelUp();
      showNotification('success', 'XP Earned!', `+${Math.floor(5 * calculateStreakBonus())} XP for asking questions`);
    }

  } catch (error) {
    console.error('Failed to send message:', error);
    hideTyping();
    
    // Fall back to original AI response generation
    const response = generateEnhancedResponse(message);
    addMessage(response);
    
    if (currentUser) {
      currentUser.stats.questionsAsked++;
      currentUser.stats.xpPoints += Math.floor(5 * calculateStreakBonus());
      updateUserInterface();
      updateStoredUser();
      checkLevelUp();
    }
  } finally {
    // Re-enable input
    input.disabled = false;
    if (sendButton) sendButton.disabled = false;
    if (sendIcon) sendIcon.style.display = 'inline-block';
    if (sendLoading) sendLoading.style.display = 'none';
    input.focus();
  }
}

// Add these new functions to your script.js file

// === CHAT HISTORY SYSTEM ===

// Initialize chat history
function initializeChatHistory() {
  loadChatHistory();
  loadChatStatistics();
}

// Load chat history with filters
async function loadChatHistory(page = 1) {
  if (!authToken) return;
  
  chatHistory.loading = true;
  chatHistory.currentPage = page;
  
  showHistoryLoading();

  try {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: '10',
      ...chatHistory.filters
    });

    const response = await fetch(`/api/chat/history?${params}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    chatHistory.sessions = data.sessions;
    chatHistory.totalPages = data.pagination.pages;
    
    displayChatHistory(data.sessions);
    updateSubjectFilter(data.subjects);
    updatePagination(data.pagination);
    hideHistoryLoading();
    
    if (data.sessions.length === 0 && page === 1) {
      showEmptyState();
    }

  } catch (error) {
    console.error('Failed to load chat history:', error);
    showNotification('error', 'Error', 'Failed to load chat history');
    hideHistoryLoading();
  } finally {
    chatHistory.loading = false;
  }
}

// Display chat sessions
function displayChatHistory(sessions) {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  if (sessions.length === 0) {
    historyList.innerHTML = '';
    return;
  }

  historyList.innerHTML = sessions.map(session => createSessionCard(session)).join('');
}

// Create session card HTML
function createSessionCard(session) {
  const date = new Date(session.createdAt).toLocaleDateString();
  const time = new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const preview = session.preview || 'No messages';
  const duration = session.duration ? `${session.duration}m` : '';
  const messageCount = session.messageCount || 0;
  
  return `
    <div class="session-card" data-session-id="${session._id}">
      <div class="session-header">
        <div class="session-info">
          <div class="session-checkbox" style="display: none;">
            <input type="checkbox" id="session-${session._id}" onchange="toggleSessionSelect('${session._id}')">
          </div>
          <div class="session-title">
            <h4 class="session-subject">${escapeHtml(session.subject)}</h4>
            <div class="session-meta">
              <span class="session-date">
                <i class="fas fa-calendar-alt"></i>
                ${date} at ${time}
              </span>
              <span class="session-stats">
                <i class="fas fa-comments"></i>
                ${messageCount} messages
              </span>
              ${duration ? `<span class="session-duration"><i class="fas fa-clock"></i> ${duration}</span>` : ''}
            </div>
          </div>
        </div>
        
        <div class="session-actions">
          <button class="btn-icon" onclick="viewSession('${session._id}')" title="View Chat">
            <i class="fas fa-eye"></i>
          </button>
          <button class="btn-icon" onclick="continueSession('${session._id}')" title="Continue Chat">
            <i class="fas fa-play"></i>
          </button>
          <div class="dropdown">
            <button class="btn-icon dropdown-toggle" onclick="toggleSessionMenu('${session._id}')" title="More Options">
              <i class="fas fa-ellipsis-v"></i>
            </button>
            <div class="dropdown-menu" id="menu-${session._id}">
              <button class="dropdown-item" onclick="renameSession('${session._id}', '${escapeHtml(session.subject)}')">
                <i class="fas fa-edit"></i> Rename
              </button>
              <button class="dropdown-item" onclick="exportSession('${session._id}', 'txt')">
                <i class="fas fa-download"></i> Export as TXT
              </button>
              <button class="dropdown-item" onclick="exportSession('${session._id}', 'md')">
                <i class="fas fa-file-alt"></i> Export as Markdown
              </button>
              <button class="dropdown-item text-danger" onclick="deleteSession('${session._id}')">
                <i class="fas fa-trash"></i> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="session-preview">
        <p>${escapeHtml(preview)}${preview.length >= 150 ? '...' : ''}</p>
      </div>
    </div>
  `;
}

// View full session
async function viewSession(sessionId) {
  if (!authToken) return;
  
  showNotification('info', 'Loading', 'Loading chat session...');
  
  try {
    const response = await fetch(`/api/chat/session/${sessionId}/full`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    showSessionModal(data.session);

  } catch (error) {
    console.error('Failed to load session:', error);
    showNotification('error', 'Error', 'Failed to load chat session');
  }
}

// Show session in modal
function showSessionModal(session) {
  const modal = document.createElement('div');
  modal.className = 'session-modal-overlay';
  modal.innerHTML = `
    <div class="session-modal">
      <div class="session-modal-header">
        <h3>${escapeHtml(session.subject)}</h3>
        <div class="session-modal-meta">
          <span>${new Date(session.startTime).toLocaleString()}</span>
          <span>${session.messages.length} messages</span>
        </div>
        <button class="modal-close" onclick="this.closest('.session-modal-overlay').remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      
      <div class="session-modal-content">
        <div class="session-messages">
          ${session.messages.map(message => `
            <div class="message ${message.role}-message">
              <div class="message-avatar">${message.role === 'user' ? '👤' : '🤖'}</div>
              <div class="message-content">
                ${processMessageContent(message.content)}
                <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="session-modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.session-modal-overlay').remove()">
          Close
        </button>
        <button class="btn" onclick="continueSessionFromModal('${session._id}')">
          <i class="fas fa-play"></i>
          Continue Chat
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Auto-scroll to bottom
  const messagesContainer = modal.querySelector('.session-messages');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Continue session from modal
function continueSessionFromModal(sessionId) {
  document.querySelector('.session-modal-overlay').remove();
  continueSession(sessionId);
}

// Continue existing session
async function continueSession(sessionId) {
  try {
    // Switch to chat section
    showSection('chat');
    
    // Load the session into current chat
    currentChatSessionId = sessionId;
    
    const response = await fetch(`/api/chat/session/${sessionId}/full`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const session = data.session;
    
    // Clear current chat messages
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
      
      // Add existing messages
      session.messages.forEach(message => {
        addMessage(message.content, message.role === 'user');
      });
    }
    
    // Update chat input focus
    const userInput = document.getElementById('userInput');
    if (userInput) {
      userInput.focus();
      userInput.placeholder = `Continue your ${session.subject} discussion...`;
    }
    
    showNotification('success', 'Session Loaded', `Continuing your ${session.subject} chat`);
    
  } catch (error) {
    console.error('Failed to continue session:', error);
    showNotification('error', 'Error', 'Failed to load session for continuation');
  }
}

// Delete session
async function deleteSession(sessionId) {
  if (!confirm('Are you sure you want to delete this chat session? This action cannot be undone.')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/chat/session/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Remove from UI
    const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (sessionCard) {
      sessionCard.style.animation = 'slideOutRight 0.3s ease-in forwards';
      setTimeout(() => {
        sessionCard.remove();
        // Reload if this was the last session on the page
        if (document.querySelectorAll('.session-card').length === 0) {
          loadChatHistory(chatHistory.currentPage);
        }
      }, 300);
    }
    
    showNotification('success', 'Deleted', 'Chat session deleted successfully');
    
  } catch (error) {
    console.error('Failed to delete session:', error);
    showNotification('error', 'Error', 'Failed to delete session');
  }
}

// Rename session
async function renameSession(sessionId, currentTitle) {
  const newTitle = prompt('Enter new title for this chat session:', currentTitle);
  if (!newTitle || newTitle.trim() === '' || newTitle === currentTitle) {
    return;
  }
  
  try {
    const response = await fetch(`/api/chat/session/${sessionId}/title`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: newTitle.trim() })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Update UI
    const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (sessionCard) {
      const titleElement = sessionCard.querySelector('.session-subject');
      if (titleElement) {
        titleElement.textContent = newTitle.trim();
      }
    }
    
    showNotification('success', 'Updated', 'Session title updated successfully');
    
  } catch (error) {
    console.error('Failed to rename session:', error);
    showNotification('error', 'Error', 'Failed to update session title');
  }
}

// Export session
async function exportSession(sessionId, format = 'json') {
  try {
    showNotification('info', 'Exporting', 'Preparing your chat export...');
    
    const response = await fetch(`/api/chat/session/${sessionId}/export?format=${format}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Get filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition');
    const filename = contentDisposition 
      ? contentDisposition.split('filename=')[1].replace(/"/g, '')
      : `chat-export.${format}`;

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showNotification('success', 'Exported', 'Chat session exported successfully');
    
  } catch (error) {
    console.error('Failed to export session:', error);
    showNotification('error', 'Error', 'Failed to export session');
  }
}

// Helper function to extract subject from message
function extractSubjectFromMessage(message) {
  const lowerMessage = message.toLowerCase();
  const subjects = {
    'Mathematics': ['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'equation', 'derivative', 'integral'],
    'Physics': ['physics', 'quantum', 'newton', 'force', 'energy', 'motion', 'mechanics'],
    'Chemistry': ['chemistry', 'chemical', 'molecule', 'reaction', 'ph', 'atom', 'compound'],
    'Biology': ['biology', 'cell', 'dna', 'organism', 'evolution', 'genetics', 'anatomy'],
    'Computer Science': ['programming', 'code', 'computer', 'algorithm', 'python', 'javascript', 'software'],
    'English': ['essay', 'writing', 'write', 'grammar', 'literature', 'paragraph', 'composition'],
    'History': ['history', 'historical', 'ancient', 'war', 'civilization', 'timeline', 'empire'],
    'Geography': ['geography', 'country', 'continent', 'climate', 'map', 'location', 'region']
  };
  
  for (const [subject, keywords] of Object.entries(subjects)) {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      return subject;
    }
  }
  
  return 'General Study';
}

// Search and filter functions
function searchChatHistory() {
  const searchInput = document.getElementById('historySearch');
  if (searchInput) {
    chatHistory.filters.search = searchInput.value.trim();
    loadChatHistory(1);
  }
}

function filterChatHistory() {
  const subjectSelect = document.getElementById('historySubject');
  const dateFromInput = document.getElementById('historyDateFrom');
  const dateToInput = document.getElementById('historyDateTo');
  
  if (subjectSelect) chatHistory.filters.subject = subjectSelect.value;
  if (dateFromInput) chatHistory.filters.dateFrom = dateFromInput.value;
  if (dateToInput) chatHistory.filters.dateTo = dateToInput.value;
  
  loadChatHistory(1);
}

function clearHistoryFilters() {
  chatHistory.filters = {
    search: '',
    subject: '',
    dateFrom: '',
    dateTo: ''
  };
  
  const searchInput = document.getElementById('historySearch');
  const subjectSelect = document.getElementById('historySubject');
  const dateFromInput = document.getElementById('historyDateFrom');
  const dateToInput = document.getElementById('historyDateTo');
  
  if (searchInput) searchInput.value = '';
  if (subjectSelect) subjectSelect.value = '';
  if (dateFromInput) dateFromInput.value = '';
  if (dateToInput) dateToInput.value = '';
  
  loadChatHistory(1);
}

function refreshChatHistory() {
  loadChatHistory(chatHistory.currentPage);
  loadChatStatistics();
}

// Bulk selection functions
function toggleBulkSelect() {
  const isSelecting = document.getElementById('bulkSelectText').textContent === 'Select';
  const checkboxes = document.querySelectorAll('.session-checkbox');
  const bulkActions = document.getElementById('bulkActions');
  
  checkboxes.forEach(checkbox => {
    checkbox.style.display = isSelecting ? 'block' : 'none';
  });
  
  if (bulkActions) {
    bulkActions.style.display = isSelecting ? 'flex' : 'none';
  }
  
  document.getElementById('bulkSelectText').textContent = isSelecting ? 'Cancel' : 'Select';
  
  if (!isSelecting) {
    // Clear selections
    chatHistory.selectedSessions.clear();
    document.querySelectorAll('.session-card input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });
    updateSelectedCount();
  }
}

function cancelBulkSelect() {
  toggleBulkSelect();
}

function toggleSessionSelect(sessionId) {
  if (chatHistory.selectedSessions.has(sessionId)) {
    chatHistory.selectedSessions.delete(sessionId);
  } else {
    chatHistory.selectedSessions.add(sessionId);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  const selectedCount = document.getElementById('selectedCount');
  if (selectedCount) {
    selectedCount.textContent = `${chatHistory.selectedSessions.size} selected`;
  }
}

// Bulk delete sessions
async function bulkDeleteSessions() {
  if (chatHistory.selectedSessions.size === 0) {
    showNotification('warning', 'No Selection', 'Please select sessions to delete');
    return;
  }
  
  const count = chatHistory.selectedSessions.size;
  if (!confirm(`Are you sure you want to delete ${count} chat session${count > 1 ? 's' : ''}? This action cannot be undone.`)) {
    return;
  }
  
  try {
    const sessionIds = Array.from(chatHistory.selectedSessions);
    
    const response = await fetch('/api/chat/sessions/bulk-delete', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionIds })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Remove deleted sessions from UI
    sessionIds.forEach(sessionId => {
      const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
      if (sessionCard) {
        sessionCard.remove();
      }
    });
    
    // Clear selections and exit bulk mode
    chatHistory.selectedSessions.clear();
    toggleBulkSelect();
    
    showNotification('success', 'Deleted', `${data.deleted} session${data.deleted > 1 ? 's' : ''} deleted successfully`);
    
    // Reload if page is empty
    if (document.querySelectorAll('.session-card').length === 0) {
      loadChatHistory(chatHistory.currentPage);
    }
    
  } catch (error) {
    console.error('Failed to bulk delete sessions:', error);
    showNotification('error', 'Error', 'Failed to delete sessions');
  }
}

// Utility functions
function loadHistoryPage(page) {
  if (page < 1 || page > chatHistory.totalPages || chatHistory.loading) {
    return;
  }
  loadChatHistory(page);
}

function updatePagination(pagination) {
  const paginationContainer = document.getElementById('historyPagination');
  const prevButton = document.getElementById('prevPage');
  const nextButton = document.getElementById('nextPage');
  const paginationInfo = document.getElementById('paginationInfo');
  
  if (!paginationContainer) return;
  
  if (pagination.pages > 1) {
    paginationContainer.style.display = 'flex';
    
    if (prevButton) {
      prevButton.disabled = pagination.page <= 1;
    }
    
    if (nextButton) {
      nextButton.disabled = pagination.page >= pagination.pages;
    }
    
    if (paginationInfo) {
      paginationInfo.textContent = `Page ${pagination.page} of ${pagination.pages}`;
    }
  } else {
    paginationContainer.style.display = 'none';
  }
}

function updateSubjectFilter(subjects) {
  const subjectSelect = document.getElementById('historySubject');
  if (!subjectSelect) return;
  
  const currentValue = subjectSelect.value;
  subjectSelect.innerHTML = '<option value="">All Subjects</option>';
  
  subjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    if (subject === currentValue) {
      option.selected = true;
    }
    subjectSelect.appendChild(option);
  });
}

function loadChatStatistics() {
  if (!authToken) return;
  
  fetch('/api/chat/statistics', {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  })
  .then(response => response.json())
  .then(stats => {
    const statsContainer = document.getElementById('historyStats');
    
    if (statsContainer && stats.totalSessions > 0) {
      statsContainer.style.display = 'flex';
      
      const elements = {
        totalSessions: stats.totalSessions,
        totalMessages: stats.totalMessages,
        totalDuration: Math.round((stats.totalDuration || 0) / 60),
        uniqueSubjects: stats.uniqueSubjects
      };

      Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      });
    }
  })
  .catch(error => console.error('Failed to load chat statistics:', error));
}

function showHistoryLoading() {
  const loading = document.getElementById('historyLoading');
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  
  if (loading) loading.style.display = 'block';
  if (list) list.style.display = 'none';
  if (empty) empty.style.display = 'none';
}

function hideHistoryLoading() {
  const loading = document.getElementById('historyLoading');
  const list = document.getElementById('historyList');
  
  if (loading) loading.style.display = 'none';
  if (list) list.style.display = 'block';
}

function showEmptyState() {
  const empty = document.getElementById('historyEmpty');
  const list = document.getElementById('historyList');
  
  if (empty) empty.style.display = 'block';
  if (list) list.style.display = 'none';
}

function toggleSessionMenu(sessionId) {
  document.querySelectorAll('.dropdown-menu').forEach(menu => {
    if (menu.id !== `menu-${sessionId}`) {
      menu.style.display = 'none';
    }
  });
  
  const menu = document.getElementById(`menu-${sessionId}`);
  if (menu) {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  }
}

function startNewChatSession() {
  currentChatSessionId = null;
  const messagesContainer = document.getElementById('chatMessages');
  if (messagesContainer) {
    messagesContainer.innerHTML = `
      <div class="welcome-section">
        <span class="welcome-emoji">🎓</span>
        <h2 class="welcome-title">New Study Session!</h2>
        <p class="welcome-subtitle">Ready to learn something new?</p>
      </div>
    `;
  }
  
  const userInput = document.getElementById('userInput');
  if (userInput) {
    userInput.placeholder = 'Ask me anything about your studies...';
    userInput.focus();
  }
}

function addHistoryQuickAction() {
  const quickActions = document.querySelector('.quick-actions');
  if (quickActions && !document.querySelector('.history-quick-action')) {
    const historyAction = document.createElement('div');
    historyAction.className = 'quick-action history-quick-action';
    historyAction.onclick = () => showSection('history');
    historyAction.innerHTML = `
      <span class="quick-action-icon">📚</span>
      <div class="quick-action-title">Chat History</div>
      <div class="quick-action-desc">View past conversations</div>
    `;
    quickActions.appendChild(historyAction);
  }
}

// Override showSection to initialize history
const originalShowSection = window.showSection;
window.showSection = function(sectionName) {
  originalShowSection(sectionName);
  
  if (sectionName === 'history' && authToken) {
    if (chatHistory.sessions.length === 0) {
      loadChatHistory();
    }
  }
  
  if (sectionName === 'chat') {
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer && messagesContainer.children.length === 0) {
      startNewChatSession();
    }
  }
};

// Global event listeners for history
document.addEventListener('click', (event) => {
  if (!event.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
      menu.style.display = 'none';
    });
  }
});

document.addEventListener('keydown', (event) => {
  // Ctrl/Cmd + H to go to history
  if ((event.ctrlKey || event.metaKey) && event.key === 'h') {
    event.preventDefault();
    showSection('history');
  }
  
  // Ctrl/Cmd + N to start new session (when in chat section)
  if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
    const activeSection = document.querySelector('.content-section.active');
    if (activeSection && activeSection.dataset.section === 'chat') {
      event.preventDefault();
      startNewChatSession();
      showNotification('info', 'New Session', 'Started a new chat session');
    }
  }
  
  // History section specific shortcuts
  const activeSection = document.querySelector('.content-section.active');
  if (!activeSection || activeSection.dataset.section !== 'history') {
    return;
  }
  
  // Ctrl/Cmd + F to focus search
  if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
    event.preventDefault();
    const searchInput = document.getElementById('historySearch');
    if (searchInput) searchInput.focus();
  }
  
  // Escape to clear search
  if (event.key === 'Escape') {
    const searchInput = document.getElementById('historySearch');
    if (searchInput && searchInput === document.activeElement) {
      searchInput.value = '';
      searchInput.blur();
      clearHistoryFilters();
    }
  }
});

// Expose functions globally for onclick handlers
window.searchChatHistory = searchChatHistory;
window.filterChatHistory = filterChatHistory;
window.clearHistoryFilters = clearHistoryFilters;
window.refreshChatHistory = refreshChatHistory;
window.toggleBulkSelect = toggleBulkSelect;
window.cancelBulkSelect = cancelBulkSelect;
window.bulkDeleteSessions = bulkDeleteSessions;
window.loadHistoryPage = loadHistoryPage;
window.viewSession = viewSession;
window.continueSession = continueSession;
window.continueSessionFromModal = continueSessionFromModal;
window.deleteSession = deleteSession;
window.renameSession = renameSession;
window.exportSession = exportSession;
window.toggleSessionSelect = toggleSessionSelect;
window.toggleSessionMenu = toggleSessionMenu;
window.startNewChatSession = startNewChatSession;
// === APP INITIALIZATION ===
document.addEventListener('DOMContentLoaded', function() {
  initializeApp();
});

async function initializeApp() {
  console.log('🚀 Initializing StudyBuddy AI...');
  
  // Check for saved auth token
  const savedToken = getStorageItem('studyBuddyToken');
  if (savedToken) {
    authToken = savedToken;
    await loadUserProfile();
    initializeSocket();
  } else {
    showAuthModal();
  }
  
  // Initialize all components
  initializeEventListeners();
  initializeTimer();
  loadSavedTheme();
  loadDraftMessage();
  addFloatingAnimationStyles();
  
  // Load data
  loadDashboardData();
  loadAchievements();
  
  // Initialize charts with delay
  setTimeout(initializeCharts, 1000);
  
  // Initialize visual effects
  setTimeout(initializeVisualEffects, 2000);
  
  // Check PWA support
  checkPWASupport();
  
  // Enable auto-save and periodic checks
  enableAutoSave();
  setInterval(checkAchievements, 10000);
  
  // Focus input
  setTimeout(() => {
    const input = document.getElementById('userInput');
    if (input) input.focus();
  }, 500);
  
  console.log('✅ StudyBuddy AI initialized successfully!');
}

// === EVENT LISTENERS ===
function initializeEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = e.target.closest('.nav-link').dataset.section;
      showSection(section);
    });
  });

  // Chat input
  const userInput = document.getElementById('userInput');
  if (userInput) {
    userInput.addEventListener('input', function() {
      // Auto-resize textarea
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      
      // Auto-save draft
      clearTimeout(draftTimeout);
      draftTimeout = setTimeout(() => {
        setStorageItem('studyBuddyDraft', this.value);
      }, 1000);
    });

    userInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // File input handler
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
  }

  // Global keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + K to focus input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('userInput');
      if (input) input.focus();
    }
    
    // Escape to clear input
    if (e.key === 'Escape') {
      const input = document.getElementById('userInput');
      if (input) {
        input.value = '';
        input.style.height = 'auto';
        removeStorageItem('studyBuddyDraft');
      }
    }
  });

  // Track user activity for streak calculation
  document.addEventListener('click', updateStreak);
  document.addEventListener('keydown', updateStreak);
}

// === AUTHENTICATION ===
function showAuthModal() {
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000; animation: fadeIn 0.3s ease-out;">
      <div style="background: var(--bg-primary); border-radius: var(--border-radius); padding: 40px; max-width: 400px; width: 90%; text-align: center; animation: scaleIn 0.3s ease-out;">
        <h2 style="color: var(--text-primary); margin-bottom: 20px;">Welcome to StudyBuddy AI</h2>
        <div id="authTabs" style="display: flex; gap: 20px; margin-bottom: 20px; justify-content: center;">
          <button class="btn" onclick="showLoginForm()" id="loginTab">Login</button>
          <button class="btn btn-secondary" onclick="showRegisterForm()" id="registerTab">Register</button>
        </div>
        <div id="authForm"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  showLoginForm();
}

function showLoginForm() {
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  if (loginTab) loginTab.className = 'btn';
  if (registerTab) registerTab.className = 'btn btn-secondary';
  
  const authForm = document.getElementById('authForm');
  if (authForm) {
    authForm.innerHTML = `
      <form onsubmit="login(event)">
        <input type="email" id="loginEmail" placeholder="Email" required style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); box-sizing: border-box;">
        <input type="password" id="loginPassword" placeholder="Password" required style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); box-sizing: border-box;">
        <button type="submit" class="btn" style="width: 100%;">Login</button>
      </form>
      <p style="margin-top: 16px; color: var(--text-secondary); font-size: 14px;">
        Use your account to login. If you don't have one, switch to Register.
      </p>
    `;
  }
}

function showRegisterForm() {
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  if (loginTab) loginTab.className = 'btn btn-secondary';
  if (registerTab) registerTab.className = 'btn';
  
  const authForm = document.getElementById('authForm');
  if (authForm) {
    authForm.innerHTML = `
      <form onsubmit="register(event)">
        <input type="text" id="registerUsername" placeholder="Username" required style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); box-sizing: border-box;">
        <input type="email" id="registerEmail" placeholder="Email" required style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); box-sizing: border-box;">
        <input type="password" id="registerPassword" placeholder="Password" required style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); box-sizing: border-box;">
        <button type="submit" class="btn" style="width: 100%;">Register</button>
      </form>
    `;
  }
}

async function login(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  console.log('🔐 Login attempt started', { email: email?.substring(0, 3) + '***' });

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    console.log('🔐 Login response status:', res.status);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('🔐 Login failed:', err);
      throw new Error(err.error || `Login failed (${res.status})`);
    }

    const data = await res.json();
    console.log('🔐 Login successful, received data:', { hasToken: !!data.token, user: data.user?.username });
    
    authToken = data.token;
    currentUser = data.user;

    setStorageItem('studyBuddyToken', authToken);
    setStorageItem('currentUser', JSON.stringify(currentUser));

    closeAuthModal();
    updateUserInterface();
    initializeSocket();
    showNotification('success', 'Welcome back!', `Hello ${currentUser.username}!`);
  } catch (e) {
    console.error('🔐 Login error:', e);
    showNotification('error', 'Login Failed', e.message || 'Unable to login');
  }
}

async function register(event) {
  event.preventDefault();
  const username = document.getElementById('registerUsername').value;
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;

  console.log('📝 Registration attempt started', { username, email: email?.substring(0, 3) + '***' });

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    console.log('📝 Registration response status:', res.status);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('📝 Registration failed:', err);
      throw new Error(err.error || `Registration failed (${res.status})`);
    }

    const data = await res.json();
    authToken = data.token;
    currentUser = data.user;

    setStorageItem('studyBuddyToken', authToken);
    setStorageItem('currentUser', JSON.stringify(currentUser));

    closeAuthModal();
    updateUserInterface();
    initializeSocket();
    showNotification('success', 'Welcome!', `Account created successfully, ${currentUser.username}!`);
  } catch (e) {
    console.error('Register error:', e);
    showNotification('error', 'Registration Failed', e.message || 'Unable to register');
  }
}

function closeAuthModal() {
  const modal = document.querySelector('[style*="position: fixed"]');
  if (modal) modal.remove();
}

async function logout() {
  try {
    if (authToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }).catch(() => {});
    }
  } finally {
    removeStorageItem('studyBuddyToken');
    removeStorageItem('currentUser');
    authToken = null;
    currentUser = null;
    if (socket) socket.disconnect();
    location.reload();
  }
}

async function loadUserProfile() {
  const savedUser = getStorageItem('currentUser');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      updateUserInterface();
      return;
    } catch (e) {
      console.error('Error parsing saved user:', e);
    }
  }

  if (!authToken) return;

  try {
    const res = await fetch('/api/auth/profile', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentUser = data.user;
    setStorageItem('currentUser', JSON.stringify(currentUser));
    updateUserInterface();
  } catch (e) {
    console.warn('Failed to load profile from backend, using minimal state.');
  }
}

// === UI & NAVIGATION ===
function updateUserInterface() {
  if (!currentUser) return;
  
  const elements = {
    userName: currentUser.username,
    userLevel: currentUser.stats.level,
    userAvatar: currentUser.username[0].toUpperCase(),
    profileAvatar: currentUser.username[0].toUpperCase(),
    profileName: currentUser.username,
    profileLevel: currentUser.stats.level,
    totalStudyTime: Math.floor(currentUser.stats.totalStudyTime / 60),
    questionsAsked: currentUser.stats.questionsAsked,
    currentStreak: currentUser.stats.currentStreak,
    xpPoints: currentUser.stats.xpPoints
  };

  Object.entries(elements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
}

function showSection(sectionName) {
  // Update navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
  });
  const activeLink = document.querySelector(`[data-section="${sectionName}"]`);
  if (activeLink) activeLink.classList.add('active');
  
  // Update content sections
  document.querySelectorAll('.content-section').forEach(section => {
    section.classList.remove('active');
  });
  const activeSection = document.querySelector(`[data-section="${sectionName}"].content-section`);
  if (activeSection) activeSection.classList.add('active');
  
  // Update page title
  const titles = {
    chat: 'AI Study Assistant',
    dashboard: 'Dashboard',
    quiz: 'Practice Quiz',
    achievements: 'Achievements',
    'study-timer': 'Study Timer',
    progress: 'Learning Progress',
    profile: 'Profile Settings'
  };
  
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    pageTitle.innerHTML = `<i class="${getIconForSection(sectionName)}"></i> ${titles[sectionName] || 'StudyBuddy AI'}`;
  }
}

function getIconForSection(section) {
  const icons = {
    chat: 'fas fa-comments',
    dashboard: 'fas fa-chart-line',
    quiz: 'fas fa-brain',
    achievements: 'fas fa-trophy',
    'study-timer': 'fas fa-clock',
    progress: 'fas fa-graduation-cap',
    profile: 'fas fa-user'
  };
  return icons[section] || 'fas fa-home';
}

// === SOCKET INITIALIZATION ===
function initializeSocket() {
  if (typeof io !== 'undefined' && authToken) {
    try {
      socket = io({
        auth: { token: authToken },
        transports: ['websocket', 'polling'],
        withCredentials: true
      });

      socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
      });

      socket.on('connect_error', (err) => {
        console.warn('Socket connect error:', err?.message || err);
      });

      // Example listeners (server emits message_received to rooms)
      socket.on('message_received', (payload) => {
        if (payload?.content) {
          addMessage(payload.content, payload.role === 'user');
        }
      });
    } catch (e) {
      console.warn('Socket initialization failed:', e);
    }
  } else {
    console.log('Socket not initialized (missing io or token)');
  }
}

// === CHAT SYSTEM ===
function quickQuestion(question) {
  const input = document.getElementById('userInput');
  if (input) {
    input.value = question;
    sendMessage();
  }
}

// (Removed duplicate demo-only sendMessage implementation)

function generateEnhancedResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  // Math responses
  if (lowerMessage.includes('math') || lowerMessage.includes('equation') || lowerMessage.includes('solve') || lowerMessage.includes('x²') || lowerMessage.includes('derivative') || lowerMessage.includes('integral')) {
    const mathResponses = [
      "Let me help you with that math problem! For the equation x² + 5x + 6 = 0:\n\n**Solution by Factoring:**\n1. Find two numbers that multiply to 6 and add to 5 → 2 and 3\n2. Factor: (x + 2)(x + 3) = 0\n3. Solutions: x = -2 or x = -3\n\n**Check:** (-2)² + 5(-2) + 6 = 4 - 10 + 6 = 0 ✓\n\nWould you like me to show other solving methods like the quadratic formula?",
      
      "Great calculus question! For derivatives, remember the **power rule**: d/dx(x^n) = nx^(n-1)\n\n**Example:** d/dx(x³ + 2x² + 5x + 1)\n= 3x² + 4x + 5\n\nFor more complex functions, we use:\n• Chain rule for composite functions\n• Product rule for products\n• Quotient rule for fractions\n\nWhat specific derivative would you like help with?",
      
      "For integrals, think of them as the reverse of derivatives! Here's the basic power rule:\n\n∫x^n dx = x^(n+1)/(n+1) + C\n\n**Example:** ∫(2x³ + 4x) dx = 2x⁴/4 + 4x²/2 + C = x⁴/2 + 2x² + C\n\nRemember: Always add the constant of integration (C)!\n\nNeed help with substitution or integration by parts?"
    ];
    return mathResponses[Math.floor(Math.random() * mathResponses.length)];
  }
  
  // Physics responses
  if (lowerMessage.includes('physics') || lowerMessage.includes('quantum') || lowerMessage.includes('newton') || lowerMessage.includes('force') || lowerMessage.includes('energy')) {
    const physicsResponses = [
      "Physics is fascinating! Let's explore **quantum mechanics basics**:\n\n🌊 **Wave-Particle Duality**\n• Light and matter exhibit both wave and particle properties\n• Demonstrated in the famous double-slit experiment\n\n⚡ **Uncertainty Principle**\n• Δx × Δp ≥ ℏ/2 (Heisenberg)\n• Cannot precisely know both position and momentum\n\n🔄 **Superposition**\n• Quantum systems exist in multiple states simultaneously\n• Schrödinger's cat thought experiment\n\nWhich concept would you like me to explain deeper?",
      
      "Let's dive into **Newton's Laws of Motion**:\n\n**1st Law (Inertia):** Objects at rest stay at rest, objects in motion stay in motion, unless acted upon by a net force.\n\n**2nd Law (F=ma):** The acceleration of an object is directly proportional to the net force and inversely proportional to mass.\n\n**3rd Law (Action-Reaction):** For every action, there's an equal and opposite reaction.\n\n**Real-world example:** When you walk, you push backward on the ground (action), and the ground pushes forward on you (reaction)!\n\nWant to solve some force problems together?",
      
      "Energy is one of the most fundamental concepts in physics! Here are the key types:\n\n⚡ **Kinetic Energy:** KE = ½mv² (energy of motion)\n🏔️ **Potential Energy:** PE = mgh (stored energy due to position)\n🔥 **Thermal Energy:** Related to temperature and molecular motion\n⚛️ **Nuclear Energy:** E = mc² (Einstein's famous equation)\n\n**Conservation of Energy:** Energy cannot be created or destroyed, only transformed from one form to another.\n\nWhich energy transformation would you like to explore?"
    ];
    return physicsResponses[Math.floor(Math.random() * physicsResponses.length)];
  }
  
  // Chemistry responses
  if (lowerMessage.includes('chemistry') || lowerMessage.includes('chemical') || lowerMessage.includes('molecule') || lowerMessage.includes('reaction') || lowerMessage.includes('ph')) {
    const chemResponses = [
      "Chemistry is the study of matter and its transformations! Let's explore **atomic structure**:\n\n⚛️ **Basic Particles:**\n• Protons (+) in nucleus\n• Neutrons (neutral) in nucleus\n• Electrons (-) in orbital shells\n\n📊 **Periodic Table Organization:**\n• Atomic number = number of protons\n• Mass number = protons + neutrons\n• Groups have similar properties\n\n🔗 **Chemical Bonding:**\n• Ionic: electron transfer\n• Covalent: electron sharing\n• Metallic: electron sea\n\nWhat chemical concept interests you most?",
      
      "Let's talk about **pH and acids/bases**!\n\n📏 **pH Scale (0-14):**\n• 0-6.9: Acidic (H₂O⁺ > OH⁻)\n• 7: Neutral (pure water)\n• 7.1-14: Basic/Alkaline (OH⁻ > H₃O⁺)\n\n🧪 **Common Examples:**\n• Lemon juice: pH ~2 (acidic)\n• Baking soda: pH ~9 (basic)\n• Blood: pH ~7.4 (slightly basic)\n\n⚖️ **Buffer Systems:** Help maintain stable pH in biological systems\n\nWant to calculate pH for specific solutions?"
    ];
    return chemResponses[Math.floor(Math.random() * chemResponses.length)];
  }
  
  // Essay and writing responses
  if (lowerMessage.includes('essay') || lowerMessage.includes('writing') || lowerMessage.includes('write') || lowerMessage.includes('climate') || lowerMessage.includes('paragraph')) {
    return "I'll help you create a compelling essay! Here's a proven structure:\n\n📝 **Essay Structure:**\n\n**Introduction (10-15%)**\n• Hook: Engaging opening (statistic, question, anecdote)\n• Background: Context for your topic\n• Thesis: Clear, arguable main claim\n\n**Body Paragraphs (70-80%)**\n• Topic sentence introducing main idea\n• Evidence supporting your argument\n• Analysis explaining how evidence supports thesis\n• Transition to next paragraph\n\n**Conclusion (10-15%)**\n• Restate thesis in new words\n• Synthesize main points\n• Broader implications or call to action\n\n**Pro Tips:**\n• Start each body paragraph with a strong topic sentence\n• Use transitions: however, furthermore, consequently\n• Include counterarguments to strengthen your position\n\nWhat's your essay topic? I'll help you brainstorm specific ideas!";
  }
  
  // Study plan responses
  if (lowerMessage.includes('study plan') || lowerMessage.includes('schedule') || lowerMessage.includes('exam') || lowerMessage.includes('biology') || lowerMessage.includes('prepare')) {
    return "I'll create a personalized study plan for you! Here's a comprehensive approach:\n\n📚 **Effective Study Plan Structure:**\n\n**Phase 1: Assessment (Days 1-2)**\n• Identify topics and difficulty levels\n• Gather all materials and resources\n• Create a realistic timeline\n\n**Phase 2: Active Learning (70% of time)**\n• 🎯 Pomodoro Technique: 25min focus + 5min break\n• 🧠 Active recall: Test yourself without notes\n• 📝 Spaced repetition: Review at increasing intervals\n\n**Phase 3: Practice & Review (30% of time)**\n• Practice problems and past exams\n• Group study sessions\n• Teaching concepts to others\n\n**Daily Schedule Example:**\n• Morning: High-focus subjects (math, science)\n• Afternoon: Reading and writing tasks\n• Evening: Review and light practice\n\n**Biology-Specific Tips:**\n• Use concept maps for complex processes\n• Create flashcards for terminology\n• Draw diagrams from memory\n\nWhat subject and timeline are you working with? I'll customize this further!";
  }
  
  // Computer Science responses
  if (lowerMessage.includes('programming') || lowerMessage.includes('code') || lowerMessage.includes('computer') || lowerMessage.includes('algorithm') || lowerMessage.includes('python') || lowerMessage.includes('javascript')) {
    return "Let's dive into computer science! Here are some fundamental concepts:\n\n💻 **Programming Fundamentals:**\n\n```python\n# Example: Basic algorithm structure\ndef find_maximum(numbers):\n    max_value = numbers[0]\n    for num in numbers[1:]:\n        if num > max_value:\n            max_value = num\n    return max_value\n```\n\n🔍 **Key Concepts:**\n• **Variables:** Store and manipulate data\n• **Functions:** Reusable blocks of code\n• **Loops:** Repeat operations efficiently\n• **Conditionals:** Make decisions in code\n\n📊 **Data Structures:**\n• Arrays/Lists: Ordered collections\n• Hash Tables: Key-value pairs\n• Trees: Hierarchical data\n• Graphs: Connected nodes\n\n⚡ **Algorithm Complexity:**\n• O(1): Constant time\n• O(n): Linear time\n• O(log n): Logarithmic time\n• O(n²): Quadratic time\n\nWhat programming concept would you like to explore? I can provide code examples and explanations!";
  }
  
  // General study help responses
  const generalResponses = [
    "I'm here to help with all your academic needs! Here's how I can assist:\n\n🎯 **Subject-Specific Help:**\n• Step-by-step problem solving\n• Concept explanations with examples\n• Study strategies tailored to your learning style\n\n📝 **Writing & Communication:**\n• Essay structure and development\n• Research and citation guidance\n• Proofreading and feedback\n\n📊 **Exam Preparation:**\n• Custom study schedules\n• Practice question generation\n• Memory techniques and strategies\n\n🤝 **Study Skills:**\n• Time management techniques\n• Note-taking methods\n• Stress management tips\n\nWhat would you like to work on today? Just ask me anything!",
    
    "Let me help you succeed academically! I specialize in:\n\n🔬 **STEM Subjects:** Math, Physics, Chemistry, Biology, Computer Science\n📚 **Liberal Arts:** Literature, History, Philosophy, Writing\n🌍 **Languages:** Grammar, vocabulary, composition\n📈 **Test Prep:** Standardized tests, entrance exams\n\n**My Teaching Approach:**\n• Break down complex concepts into simple steps\n• Provide real-world examples and applications\n• Adapt explanations to your learning style\n• Encourage active learning and critical thinking\n\n**Interactive Features:**\n• Take practice quizzes to test your knowledge\n• Use the study timer for focused sessions\n• Track your progress and earn achievements\n\nWhat subject or topic can I help you master today?",
    
    "Welcome to your personalized learning experience! I'm designed to help you:\n\n✨ **Understand Difficult Concepts**\n• Visual explanations and analogies\n• Multiple perspectives on the same topic\n• Progressive complexity building\n\n🎓 **Develop Study Skills**\n• Effective note-taking techniques\n• Memory improvement strategies\n• Time management for students\n\n💡 **Problem-Solving Approach**\n• Identify what you know vs. don't know\n• Break problems into manageable steps\n• Check your work and understand mistakes\n\n**Pro Tip:** The best learning happens when you actively engage! Try explaining concepts back to me or asking \"what if\" questions.\n\nWhat's on your mind today? Let's learn together!"
  ];
  
  return generalResponses[Math.floor(Math.random() * generalResponses.length)];
}

function addMessage(content, isUser = false) {
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;
  
  // Remove welcome message if present
  const welcomeMessage = messagesContainer.querySelector('.welcome-section');
  if (welcomeMessage) welcomeMessage.remove();

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user' : 'bot'}-message`;
  
  const avatar = isUser ? '👤' : '🤖';
  const time = getCurrentTime();
  const processedContent = processMessageContent(content);
  
  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      ${processedContent}
      <div class="message-time">${time}</div>
    </div>
  `;
  
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  // Render math if present
  if (typeof MathJax !== 'undefined' && content.includes('$$')) {
    MathJax.typesetPromise([messageDiv]).catch(e => console.log('MathJax error:', e));
}
  
return messageDiv;

}

function processMessageContent(content) {
  // Process code blocks
  content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
    return `
      <div class="code-block" style="background: var(--bg-secondary); border-radius: 8px; margin: 12px 0; overflow: hidden;">
        <div class="code-header" style="background: rgba(0,0,0,0.2); padding: 8px 16px; display: flex; justify-content: space-between; align-items: center;">
          <span class="code-language" style="color: #10b981; font-size: 12px; text-transform: uppercase; font-weight: 600;">${language || 'code'}</span>
          <button class="copy-code" onclick="copyCode(this)" style="background: none; border: 1px solid rgba(255,255,255,0.3); color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Copy</button>
        </div>
        <pre style="padding: 16px; margin: 0; overflow-x: auto;"><code style="color: #e5e7eb; font-family: 'Courier New', monospace;">${escapeHtml(code.trim())}</code></pre>
      </div>
    `;
  });
  
  // Process inline code
  content = content.replace(/`([^`]+)`/g, '<code style="background: rgba(99,102,241,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #6366f1;">$1</code>');
  
  // Process math expressions
  content = content.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-expression" style="text-align: center; margin: 12px 0; padding: 12px; background: rgba(99,102,241,0.1); border-radius: 8px;">$1$</div>');
  content = content.replace(/\$([^$]+)\$/g, '<span class="math-expression" style="background: rgba(99,102,241,0.1); padding: 2px 4px; border-radius: 4px;">$1$</span>');
  
  // Process markdown formatting
  content = content.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #10b981;">$1</strong>');
  content = content.replace(/\*(.*?)\*/g, '<em style="color: #f59e0b;">$1</em>');
  
  // Process line breaks and paragraphs
  content = content.replace(/\n\n/g, '<br><br>');
  content = content.replace(/\n/g, '<br>');
  
  return content;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyCode(button) {
  const codeBlock = button.closest('.code-block').querySelector('code');
  if (navigator.clipboard && codeBlock) {
    navigator.clipboard.writeText(codeBlock.textContent)
      .then(() => {
        button.textContent = 'Copied!';
        setTimeout(() => button.textContent = 'Copy', 2000);
      })
      .catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = codeBlock.textContent;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        button.textContent = 'Copied!';
        setTimeout(() => button.textContent = 'Copy', 2000);
      });
  }
}

function getCurrentTime() {
  return new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function showTyping() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.classList.add('active');
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
}

function hideTyping() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.classList.remove('active');
  }
}

// === VOICE RECORDING ===
async function toggleVoiceRecording() {
  if (!isRecording) {
    await startVoiceRecording();
  } else {
    stopVoiceRecording();
  }
}

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      await processVoiceRecording(audioBlob);
    };
    
    mediaRecorder.start();
    isRecording = true;
    
    // Update UI
    const voiceIcon = document.getElementById('voiceIcon');
    if (voiceIcon) voiceIcon.className = 'fas fa-stop';
    showVoiceRecordingIndicator();
    
    showNotification('info', 'Recording', 'Voice recording started');
    
  } catch (error) {
    console.error('Voice recording error:', error);
    showNotification('error', 'Voice Error', 'Could not access microphone. Please check permissions.');
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    isRecording = false;
    
    // Update UI
    const voiceIcon = document.getElementById('voiceIcon');
    if (voiceIcon) voiceIcon.className = 'fas fa-microphone';
    hideVoiceRecordingIndicator();
  }
}

function showVoiceRecordingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'voice-recording';
  indicator.innerHTML = `
    <div class="voice-wave" style="display: flex; align-items: center; gap: 2px;">
      <span style="width: 3px; height: 12px; background: #ef4444; border-radius: 2px; animation: pulse 1.5s infinite;"></span>
      <span style="width: 3px; height: 16px; background: #ef4444; border-radius: 2px; animation: pulse 1.5s infinite 0.2s;"></span>
      <span style="width: 3px; height: 8px; background: #ef4444; border-radius: 2px; animation: pulse 1.5s infinite 0.4s;"></span>
      <span style="width: 3px; height: 14px; background: #ef4444; border-radius: 2px; animation: pulse 1.5s infinite 0.6s;"></span>
      <span style="width: 3px; height: 10px; background: #ef4444; border-radius: 2px; animation: pulse 1.5s infinite 0.8s;"></span>
    </div>
    <span style="color: #ef4444; font-weight: 600; margin-left: 8px;">Recording...</span>
  `;
  
  const inputWrapper = document.querySelector('.input-wrapper');
  if (inputWrapper) inputWrapper.appendChild(indicator);
}

function hideVoiceRecordingIndicator() {
  const indicator = document.querySelector('.voice-recording');
  if (indicator) indicator.remove();
}

async function processVoiceRecording(audioBlob) {
  // In a real implementation, this would send the audio to a speech-to-text service
  showNotification('info', 'Voice Processing', 'Speech-to-text would process your recording here. This is a demo version.');
  
  // Demo: Add a placeholder message
  setTimeout(() => {
    addMessage('Voice note received! In the full version, this would be converted to text using speech recognition.', false);
  }, 1500);
}

// === FILE UPLOAD ===
function openFileUpload() {
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.click();
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  showNotification('info', 'File Upload', `Processing ${file.name}...`);
  
  // Demo processing
  setTimeout(() => {
    const fileType = file.type;
    let message = `📄 File "${file.name}" processed successfully!\n\n`;
    
    if (fileType.includes('pdf')) {
      message += 'PDF content has been analyzed and added to your study materials. You can now ask questions about this document.';
    } else if (fileType.includes('image')) {
      message += 'Image content has been analyzed. I can help explain diagrams, charts, or text visible in the image.';
    } else if (fileType.includes('text') || fileType.includes('document')) {
      message += 'Document content has been processed. I can help with writing feedback, summarization, or questions about the content.';
    } else {
      message += 'File uploaded successfully. I can provide guidance on how to work with this type of content.';
    }
    
    addMessage(message, false);
    showNotification('success', 'File Ready', `${file.name} is ready for study assistance`);
  }, 2000);
  
  // Clear the file input
  event.target.value = '';
}

// === THEME SYSTEM ===
function toggleTheme() {
  const body = document.body;
  const themeIcon = document.getElementById('themeIcon');
  
  if (body.dataset.theme === 'light') {
    body.dataset.theme = 'dark';
    if (themeIcon) themeIcon.className = 'fas fa-sun';
    setStorageItem('theme', 'dark');
  } else {
    body.dataset.theme = 'light';
    if (themeIcon) themeIcon.className = 'fas fa-moon';
    setStorageItem('theme', 'light');
  }
  
  // Update user preferences
  if (currentUser) {
    currentUser.preferences.theme = body.dataset.theme;
    updateStoredUser();
  }
  
  showNotification('success', 'Theme Updated', `Switched to ${body.dataset.theme} mode`);
}

function loadSavedTheme() {
  const savedTheme = getStorageItem('theme') || (currentUser?.preferences?.theme) || 'dark';
  document.body.dataset.theme = savedTheme;
  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) {
    themeIcon.className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }
}

// === QUIZ SYSTEM ===
async function generateQuiz() {
  const subjectSelect = document.getElementById('quizSubject');
  const subject = subjectSelect ? subjectSelect.value : 'mathematics';
  const container = document.getElementById('quizContainer');
  
  if (container) {
    container.innerHTML = `
      <div class="loading" style="text-align: center; padding: 40px;">
        <div class="spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
        <p style="color: var(--text-secondary);">Generating personalized quiz...</p>
      </div>
    `;
  }
  
  // Generate quiz based on user level
  setTimeout(() => {
    const difficulty = getUserDifficulty();
    currentQuiz = {
      quizId: 'quiz-' + Date.now(),
      subject: subject,
      difficulty: difficulty,
      questions: generateQuizQuestions(subject, difficulty),
      userAnswers: []
    };
    currentQuestionIndex = 0;
    displayQuestion();
  }, 2000);
}

function getUserDifficulty() {
  if (!currentUser) return 'intermediate';
  const level = currentUser.stats.level;
  if (level <= 2) return 'beginner';
  if (level <= 5) return 'intermediate';
  return 'advanced';
}

function generateQuizQuestions(subject, difficulty) {
  const questionBank = {
    beginner: {
      mathematics: [
        {
          question: "What is 15 + 27?",
          options: ["42", "41", "43", "40"],
          correct: "42",
          explanation: "15 + 27 = 42. You can break it down: 15 + 25 + 2 = 40 + 2 = 42"
        },
        {
          question: "What is 8 × 7?",
          options: ["54", "56", "58", "52"],
          correct: "56",
          explanation: "8 × 7 = 56. You can think of it as (8 × 5) + (8 × 2) = 40 + 16 = 56"
        },
        {
          question: "What is 144 ÷ 12?",
          options: ["12", "11", "13", "10"],
          correct: "12",
          explanation: "144 ÷ 12 = 12. Since 12 × 12 = 144"
        }
      ],
      physics: [
        {
          question: "What is the unit of force?",
          options: ["Newton", "Joule", "Watt", "Pascal"],
          correct: "Newton",
          explanation: "Force is measured in Newtons (N), named after Sir Isaac Newton"
        },
        {
          question: "How many meters are in 1 kilometer?",
          options: ["100", "1000", "10", "10000"],
          correct: "1000",
          explanation: "1 kilometer = 1000 meters (kilo = thousand)"
        }
      ]
    },
    intermediate: {
      mathematics: [
        {
          question: "What is the derivative of x³ + 2x² - 5x + 3?",
          options: ["3x² + 4x - 5", "3x² + 2x - 5", "x² + 4x - 5", "3x² + 4x - 3"],
          correct: "3x² + 4x - 5",
          explanation: "Using the power rule: d/dx(x³) = 3x², d/dx(2x²) = 4x, d/dx(-5x) = -5, d/dx(3) = 0"
        },
        {
          question: "Solve for x: 2x² - 8x + 6 = 0",
          options: ["x = 1, 3", "x = 2, 4", "x = -1, 3", "x = 1, -3"],
          correct: "x = 1, 3",
          explanation: "Factor: 2(x² - 4x + 3) = 2(x - 1)(x - 3) = 0, so x = 1 or x = 3"
        },
        {
          question: "What is sin(30°)?",
          options: ["1/2", "√3/2", "√2/2", "1"],
          correct: "1/2",
          explanation: "sin(30°) = 1/2. This is a fundamental trigonometric value."
        }
      ],
      physics: [
        {
          question: "What is Newton's second law of motion?",
          options: ["F = ma", "E = mc²", "v = u + at", "F = kx"],
          correct: "F = ma",
          explanation: "Newton's second law states that Force equals mass times acceleration"
        },
        {
          question: "What is the acceleration due to gravity on Earth?",
          options: ["9.8 m/s²", "10 m/s²", "8.9 m/s²", "9.0 m/s²"],
          correct: "9.8 m/s²",
          explanation: "The acceleration due to gravity is approximately 9.8 m/s² (or 9.81 m/s² more precisely)"
        }
      ]
    },
    advanced: {
      mathematics: [
        {
          question: "What is the integral of sin(x)cos(x) dx?",
          options: ["sin²(x)/2 + C", "-cos²(x)/2 + C", "sin(x)cos(x) + C", "Both A and B"],
          correct: "Both A and B",
          explanation: "Using substitution or trigonometric identities: ∫sin(x)cos(x)dx = sin²(x)/2 + C = -cos²(x)/2 + C (they differ by a constant)"
        },
        {
          question: "What is the Taylor series for e^x around x = 0?",
          options: ["1 + x + x²/2! + x³/3! + ...", "x + x²/2 + x³/6 + ...", "1 + x + x² + x³ + ...", "1 - x + x²/2 - x³/6 + ..."],
          correct: "1 + x + x²/2! + x³/3! + ...",
          explanation: "The Taylor series for e^x is: e^x = 1 + x + x²/2! + x³/3! + x⁴/4! + ... = Σ(x^n/n!) for n=0 to ∞"
        }
      ],
      physics: [
        {
          question: "What is Schrödinger's equation in its time-dependent form?",
          options: ["iℏ ∂ψ/∂t = Ĥψ", "E = ℏω", "p = ℏk", "ΔxΔp ≥ ℏ/2"],
          correct: "iℏ ∂ψ/∂t = Ĥψ",
          explanation: "The time-dependent Schrödinger equation is iℏ ∂ψ/∂t = Ĥψ, where ψ is the wave function and Ĥ is the Hamiltonian operator"
        }
      ]
    }
  };
  
  const questions = questionBank[difficulty]?.[subject] || questionBank.intermediate.mathematics;
  return questions.slice(0, Math.min(5, questions.length)); // Limit to 5 questions
}

function displayQuestion() {
  if (!currentQuiz || currentQuestionIndex >= currentQuiz.questions.length) return;
  
  const question = currentQuiz.questions[currentQuestionIndex];
  const container = document.getElementById('quizContainer');
  
  if (container) {
    const progressPercent = ((currentQuestionIndex + 1) / currentQuiz.questions.length) * 100;
    
    container.innerHTML = `
      <div class="quiz-header" style="margin-bottom: 24px;">
        <div class="quiz-progress" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="color: white; font-weight: 600;">Question ${currentQuestionIndex + 1} of ${currentQuiz.questions.length}</span>
            <span style="color: rgba(255,255,255,0.7); font-size: 14px;">${currentQuiz.difficulty.charAt(0).toUpperCase() + currentQuiz.difficulty.slice(1)} Level</span>
          </div>
          <div class="progress-bar" style="width: 100%; height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden;">
            <div class="progress-fill" style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>
      
      <div class="question-card" style="background: var(--bg-primary); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <div class="question-number" style="color: #6366f1; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Question ${currentQuestionIndex + 1}</div>
        <div class="question-text" style="color: white; font-size: 18px; font-weight: 600; line-height: 1.4; margin-bottom: 24px;">${question.question}</div>
        <div class="answer-options" style="display: flex; flex-direction: column; gap: 12px;">
          ${question.options.map((option, index) => `
            <button class="answer-option" onclick="selectAnswer('${escapeForAttribute(option)}', this)" style="background: var(--bg-secondary); border: 2px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; text-align: left; color: white; transition: all 0.3s ease; cursor: pointer;">
              <span style="color: #6366f1; font-weight: bold; margin-right: 12px;">${String.fromCharCode(65 + index)}.</span>
              ${option}
            </button>
          `).join('')}
        </div>
      </div>
      
      <div class="quiz-actions" style="display: flex; justify-content: space-between; gap: 16px;">
        <button class="btn btn-secondary" onclick="previousQuestion()" ${currentQuestionIndex === 0 ? 'disabled' : ''} style="flex: 1;">
          <i class="fas fa-arrow-left"></i> Previous
        </button>
        <button class="btn" onclick="nextQuestion()" id="nextQuestionBtn" disabled style="flex: 1;">
          ${currentQuestionIndex === currentQuiz.questions.length - 1 ? '<i class="fas fa-check"></i> Finish Quiz' : 'Next <i class="fas fa-arrow-right"></i>'} 
        </button>
      </div>
    `;
  }
}

function escapeForAttribute(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function selectAnswer(answer, button) {
  // Remove previous selection
  document.querySelectorAll('.answer-option').forEach(opt => {
    opt.classList.remove('selected');
    opt.style.background = 'var(--bg-secondary)';
    opt.style.borderColor = 'rgba(255,255,255,0.1)';
  });
  
  // Select current answer
  button.classList.add('selected');
  button.style.background = 'rgba(99, 102, 241, 0.2)';
  button.style.borderColor = '#6366f1';
  
  // Store answer
  currentQuiz.userAnswers = currentQuiz.userAnswers || [];
  currentQuiz.userAnswers[currentQuestionIndex] = answer;
  
  // Enable next button
  const nextBtn = document.getElementById('nextQuestionBtn');
  if (nextBtn) nextBtn.disabled = false;
}

function nextQuestion() {
  if (currentQuestionIndex < currentQuiz.questions.length - 1) {
    currentQuestionIndex++;
    displayQuestion();
  } else {
    finishQuiz();
  }
}

function previousQuestion() {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    displayQuestion();
  }
}

function finishQuiz() {
  // Calculate results
  let correctAnswers = 0;
  const results = currentQuiz.questions.map((question, index) => {
    const userAnswer = currentQuiz.userAnswers[index];
    const isCorrect = userAnswer === question.correct;
    if (isCorrect) correctAnswers++;
    
    return {
      question: question.question,
      userAnswer: userAnswer,
      correctAnswer: question.correct,
      isCorrect: isCorrect,
      explanation: question.explanation
    };
  });
  
  const score = Math.round((correctAnswers / currentQuiz.questions.length) * 100);
  const baseXP = correctAnswers * 20;
  const streakBonus = calculateStreakBonus();
  const xpEarned = Math.floor(baseXP * streakBonus);
  
  // Update user stats
  if (currentUser) {
    currentUser.stats.xpPoints += xpEarned;
    updateUserInterface();
    updateStoredUser();
    checkLevelUp();
  }
  
  // Save quiz result for analytics
  saveQuizResult(currentQuiz.subject, score, correctAnswers, currentQuiz.questions.length);
  
  displayQuizResults({
    score: score,
    correctAnswers: correctAnswers,
    totalQuestions: currentQuiz.questions.length,
    results: results,
    xpEarned: xpEarned,
    streakBonus: streakBonus
  });
  
  if (xpEarned > 0) {
    showNotification('success', 'Quiz Completed!', `+${xpEarned} XP earned!${streakBonus > 1 ? ` (${Math.floor((streakBonus - 1) * 100)}% streak bonus!)` : ''}`);
  }
}

function displayQuizResults(results) {
  const container = document.getElementById('quizContainer');
  
  if (container) {
    const performanceIcon = results.score >= 90 ? '🎉' : results.score >= 80 ? '🎯' : results.score >= 70 ? '👍' : results.score >= 60 ? '📚' : '🔄';
    const performanceMessage = results.score >= 90 ? 'Outstanding!' : results.score >= 80 ? 'Excellent work!' : results.score >= 70 ? 'Good job!' : results.score >= 60 ? 'Keep practicing!' : 'Let\'s review and try again!';
    const scoreColor = results.score >= 80 ? '#10b981' : results.score >= 60 ? '#f59e0b' : '#ef4444';
    
    container.innerHTML = `
      <div class="quiz-results" style="text-align: center;">
        <div class="results-header" style="margin-bottom: 32px;">
          <div style="font-size: 64px; margin-bottom: 16px;">${performanceIcon}</div>
          <h2 style="color: white; margin-bottom: 8px;">${performanceMessage}</h2>
          <div style="font-size: 48px; font-weight: 800; color: ${scoreColor}; margin-bottom: 8px;">
            ${results.score}%
          </div>
          <p style="color: rgba(255,255,255,0.8); margin-bottom: 16px;">
            ${results.correctAnswers} out of ${results.totalQuestions} correct
          </p>
          <div style="background: rgba(99, 102, 241, 0.2); border-radius: 20px; padding: 8px 16px; display: inline-block;">
            <span style="color: #6366f1; font-weight: 600;">+${results.xpEarned} XP earned!</span>
            ${results.streakBonus > 1 ? `<span style="color: #10b981; margin-left: 8px;">🔥 ${Math.floor((results.streakBonus - 1) * 100)}% bonus!</span>` : ''}
          </div>
        </div>
        
        <div class="results-breakdown" style="text-align: left; max-height: 400px; overflow-y: auto;">
          ${results.results.map((result, index) => `
            <div class="question-result" style="background: var(--bg-primary); border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${result.isCorrect ? '#10b981' : '#ef4444'};">
              <div style="color: var(--text-primary); font-weight: 600; margin-bottom: 12px; display: flex; align-items: center;">
                <span style="color: ${result.isCorrect ? '#10b981' : '#ef4444'}; margin-right: 8px; font-size: 18px;">
                  ${result.isCorrect ? '✓' : '✗'}
                </span>
                Question ${index + 1}: ${result.question}
              </div>
              <div style="display: grid; gap: 12px; margin-bottom: 12px;">
                <div>
                  <strong>Your Answer:</strong> 
                  <span style="color: ${result.isCorrect ? '#10b981' : '#ef4444'};">
                    ${result.userAnswer || 'Not answered'}
                  </span>
                </div>
                ${!result.isCorrect ? `
                  <div>
                    <strong>Correct Answer:</strong> 
                    <span style="color: #10b981;">${result.correctAnswer}</span>
                  </div>
                ` : ''}
              </div>
              ${result.explanation ? `
                <div style="background: rgba(99,102,241,0.1); border-radius: 8px; padding: 12px; border-left: 3px solid #6366f1;">
                  <strong style="color: #6366f1;">Explanation:</strong> ${result.explanation}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        
        <div style="margin-top: 32px; display: flex; gap: 16px; justify-content: center;">
          <button class="btn" onclick="generateQuiz()" style="flex: 1; max-width: 200px;">
            <i class="fas fa-redo"></i> Take Another Quiz
          </button>
          <button class="btn btn-secondary" onclick="showSection('dashboard')" style="flex: 1; max-width: 200px;">
            <i class="fas fa-chart-line"></i> View Progress
          </button>
        </div>
      </div>
    `;
  }
}

function saveQuizResult(subject, score, correct, total) {
  let quizHistory = getStorageItem('quizHistory');
  try {
    quizHistory = quizHistory ? JSON.parse(quizHistory) : [];
  } catch (e) {
    quizHistory = [];
  }
  
  quizHistory.push({
    date: new Date().toISOString(),
    subject: subject,
    score: score,
    correct: correct,
    total: total,
    difficulty: currentQuiz.difficulty
  });
  
  // Keep only last 50 quiz results
  if (quizHistory.length > 50) {
    quizHistory = quizHistory.slice(-50);
  }
  
  setStorageItem('quizHistory', JSON.stringify(quizHistory));
}

// === TIMER SYSTEM ===
function initializeTimer() {
  studyTimer = {
    minutes: 25,
    seconds: 0,
    isRunning: false,
    isPaused: false
  };
  updateTimerDisplay();
}

function setTimerPreset(minutes) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  if (studySession) {
    endStudySession();
  }
  
  studyTimer = {
    minutes: minutes,
    seconds: 0,
    isRunning: false,
    isPaused: false
  };
  updateTimerDisplay();
  
  // Reset UI
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  if (startBtn) {
    startBtn.style.display = 'inline-block';
    startBtn.innerHTML = '<i class="fas fa-play"></i> Start';
  }
  if (pauseBtn) pauseBtn.style.display = 'none';
}

function startTimer() {
  if (!studyTimer) initializeTimer();
  
  studyTimer.isRunning = true;
  studyTimer.isPaused = false;
  
  // Update UI
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  if (startBtn) startBtn.style.display = 'none';
  if (pauseBtn) pauseBtn.style.display = 'inline-block';
  
  timerInterval = setInterval(() => {
    if (studyTimer.seconds > 0) {
      studyTimer.seconds--;
    } else if (studyTimer.minutes > 0) {
      studyTimer.minutes--;
      studyTimer.seconds = 59;
    } else {
      clearInterval(timerInterval);
      timerFinished();
      return;
    }
    
    updateTimerDisplay();
  }, 1000);
  
  startStudySession();
}

function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  studyTimer.isPaused = true;
  
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  if (startBtn) {
    startBtn.style.display = 'inline-block';
    startBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
  }
  if (pauseBtn) pauseBtn.style.display = 'none';
}

function resetTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  if (studySession) {
    endStudySession();
  }
  
  setTimerPreset(25);
}

function updateTimerDisplay() {
  const display = document.getElementById('timerDisplay');
  if (display) {
    const minutes = String(studyTimer.minutes).padStart(2, '0');
    const seconds = String(studyTimer.seconds).padStart(2, '0');
    display.textContent = `${minutes}:${seconds}`;
  }
}

function timerFinished() {
  playNotificationSound();
  showNotification('success', 'Study Session Complete!', 'Great work! Time for a break.');
  
  // Reset timer UI
  studyTimer.isRunning = false;
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  if (startBtn) {
    startBtn.style.display = 'inline-block';
    startBtn.innerHTML = '<i class="fas fa-play"></i> Start';
  }
  if (pauseBtn) pauseBtn.style.display = 'none';
  
  endStudySession();
}

function startStudySession() {
  studySession = {
    startTime: Date.now(),
    subject: 'general',
    questionsAsked: 0,
    initialXP: currentUser?.stats.xpPoints || 0
  };
  
  console.log('Study session started');
}

function endStudySession() {
  if (!studySession) return;
  
  const duration = Math.floor((Date.now() - studySession.startTime) / 1000 / 60); // minutes
  const baseXP = Math.max(Math.floor(duration / 5) * 3, 3); // 3 XP per 5 minutes, minimum 3
  const streakBonus = calculateStreakBonus();
  const xpEarned = Math.floor(baseXP * streakBonus);
  
  if (currentUser && duration > 0) {
    currentUser.stats.totalStudyTime += duration;
    currentUser.stats.xpPoints += xpEarned;
    updateUserInterface();
    updateStoredUser();
    checkLevelUp();
    
    if (xpEarned > 0) {
      showNotification('success', 'Study XP Earned!', `+${xpEarned} XP for ${duration} minutes of focused study!${streakBonus > 1 ? ` (${Math.floor((streakBonus - 1) * 100)}% streak bonus!)` : ''}`);
    }
  }
  
  // Save session data
  saveStudySession(duration, studySession.subject, xpEarned);
  
  studySession = null;
  console.log(`Study session ended. Duration: ${duration} minutes, XP earned: ${xpEarned}`);
}

function saveStudySession(duration, subject, xpEarned) {
  let sessions = getStorageItem('studySessions');
  try {
    sessions = sessions ? JSON.parse(sessions) : [];
  } catch (e) {
    sessions = [];
  }
  
  sessions.push({
    date: new Date().toISOString(),
    duration: duration,
    subject: subject,
    xpEarned: xpEarned,
    streak: currentUser?.stats.currentStreak || 0
  });
  
  // Keep only last 100 sessions
  if (sessions.length > 100) {
    sessions = sessions.slice(-100);
  }
  
  setStorageItem('studySessions', JSON.stringify(sessions));
}

// === DATA MANAGEMENT ===
function loadDashboardData() {
  if (!currentUser) return;
  
  // Generate realistic weekly progress data
  const weeklyData = generateWeeklyProgressData();
  
  const analytics = {
    totalStudyTime: currentUser.stats.totalStudyTime,
    questionsAsked: currentUser.stats.questionsAsked,
    currentStreak: currentUser.stats.currentStreak,
    xpPoints: currentUser.stats.xpPoints,
    weeklyProgress: weeklyData
  };
  
  updateDashboard(analytics);
}

function generateWeeklyProgressData() {
  // Generate realistic study time data for the past week
  const data = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // Generate realistic study times with some variation
    let studyTime = 0;
    if (i < 2) {
      // Weekend - lighter study
      studyTime = Math.floor(Math.random() * 60) + 20; // 20-80 minutes
    } else {
      // Weekdays - more consistent study
      studyTime = Math.floor(Math.random() * 80) + 40; // 40-120 minutes
    }
    
    data.push(studyTime);
  }
  
  return data;
}

function updateDashboard(analytics) {
  // Update stats display
  const elements = {
    totalStudyTime: Math.floor(analytics.totalStudyTime / 60),
    questionsAsked: analytics.questionsAsked,
    currentStreak: analytics.currentStreak,
    xpPoints: analytics.xpPoints
  };

  Object.entries(elements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
  
  // Update charts
  updateStudyChart(analytics.weeklyProgress);
  updateSubjectProgress();
}

function loadAchievements() {
  const achievementsGrid = document.getElementById('achievementsGrid');
  if (!achievementsGrid) return;
  
  const achievements = [
    { 
      id: 'first_steps',
      icon: '🎯', 
      title: 'First Steps', 
      desc: 'Asked your first question', 
      xp: 10, 
      earned: (currentUser?.stats.questionsAsked || 0) > 0 
    },
    { 
      id: 'study_streak_7',
      icon: '📚', 
      title: 'Study Streak', 
      desc: '7 days of continuous learning', 
      xp: 100, 
      earned: (currentUser?.stats.currentStreak || 0) >= 7 
    },
    { 
      id: 'quiz_master',
      icon: '🧠', 
      title: 'Quiz Master', 
      desc: 'Score 90%+ in 5 quizzes', 
      xp: 200, 
      earned: getQuizMasteryStatus() 
    },
    { 
      id: 'subject_expert',
      icon: '⭐', 
      title: 'Subject Expert', 
      desc: 'Complete 50 questions in one subject', 
      xp: 300, 
      earned: false 
    },
    { 
      id: 'night_owl',
      icon: '🌙', 
      title: 'Night Owl', 
      desc: 'Studied past midnight', 
      xp: 25, 
      earned: Math.random() > 0.3 
    },
    { 
      id: 'early_bird',
      icon: '🌅', 
      title: 'Early Bird', 
      desc: 'Studied before 6 AM', 
      xp: 25, 
      earned: Math.random() > 0.7 
    },
    { 
      id: 'perfect_score',
      icon: '💯', 
      title: 'Perfect Score', 
      desc: 'Get 100% on any quiz', 
      xp: 50, 
      earned: Math.random() > 0.6 
    },
    { 
      id: 'study_machine',
      icon: '🔥', 
      title: 'Study Machine', 
      desc: 'Study for 2+ hours total', 
      xp: 75, 
      earned: (currentUser?.stats.totalStudyTime || 0) >= 120 
    },
    { 
      id: 'level_up_5',
      icon: '🚀', 
      title: 'Rising Star', 
      desc: 'Reach Level 5', 
      xp: 150, 
      earned: (currentUser?.stats.level || 0) >= 5 
    },
    { 
      id: 'consistent_learner',
      icon: '📈', 
      title: 'Consistent Learner', 
      desc: 'Ask 25 questions', 
      xp: 125, 
      earned: (currentUser?.stats.questionsAsked || 0) >= 25 
    }
  ];
  
  achievementsGrid.innerHTML = achievements.map(achievement => `
    <div class="achievement-card ${achievement.earned ? 'earned' : ''}" style="background: var(--bg-primary); border-radius: 12px; padding: 20px; text-align: center; transition: all 0.3s ease; ${achievement.earned ? 'border: 2px solid #10b981; box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);' : 'border: 2px solid rgba(255,255,255,0.1);'}">
      <span class="achievement-icon" style="font-size: 32px; margin-bottom: 12px; display: block; ${achievement.earned ? '' : 'filter: grayscale(1); opacity: 0.5;'}">${achievement.icon}</span>
      <div class="achievement-title" style="color: ${achievement.earned ? '#10b981' : 'var(--text-primary)'}; font-weight: 700; font-size: 14px; margin-bottom: 8px;">${achievement.title}</div>
      <div class="achievement-desc" style="color: var(--text-secondary); font-size: 12px; line-height: 1.4; margin-bottom: 12px;">${achievement.desc}</div>
      <div class="achievement-xp" style="background: ${achievement.earned ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.1)'}; color: ${achievement.earned ? '#10b981' : 'var(--text-secondary)'}; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">+${achievement.xp} XP</div>
    </div>
  `).join('');
}

function getQuizMasteryStatus() {
  const quizHistory = getStorageItem('quizHistory');
  if (!quizHistory) return false;
  
  try {
    const history = JSON.parse(quizHistory);
    const highScores = history.filter(quiz => quiz.score >= 90);
    return highScores.length >= 5;
  } catch (e) {
    return false;
  }
}

// === CHARTS SYSTEM ===
function initializeCharts() {
  setTimeout(() => {
    initializeStudyChart();
    initializeProgressChart();
  }, 500);
}

function initializeStudyChart() {
  const studyCtx = document.getElementById('studyChart');
  if (studyCtx && typeof Chart !== 'undefined') {
    new Chart(studyCtx, {
      type: 'line',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
          label: 'Study Time (minutes)',
          data: [45, 60, 75, 30, 90, 35, 50],
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#6366f1',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#ffffff' },
            position: 'bottom'
          }
        },
        scales: {
          x: { 
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          },
          y: { 
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            beginAtZero: true
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        }
      }
    });
  }
}

function initializeProgressChart() {
  const progressCtx = document.getElementById('progressChart');
  if (progressCtx && typeof Chart !== 'undefined') {
    new Chart(progressCtx, {
      type: 'radar',
      data: {
        labels: ['Math', 'Physics', 'Chemistry', 'Biology', 'Computer Science'],
        datasets: [{
          label: 'Progress (%)',
          data: [85, 72, 90, 65, 95],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.2)',
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#ffffff' },
            position: 'bottom'
          }
        },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { 
              color: '#ffffff',
              backdropColor: 'transparent',
              stepSize: 20
            },
            grid: { color: 'rgba(255, 255, 255, 0.2)' },
            pointLabels: { 
              color: '#ffffff',
              font: { size: 12 }
            }
          }
        }
      }
    });
  }
}

function updateStudyChart(data) {
  const studyCtx = document.getElementById('studyChart');
  if (studyCtx && typeof Chart !== 'undefined') {
    const chart = Chart.getChart(studyCtx);
    if (chart && data) {
      chart.data.datasets[0].data = data;
      chart.update('none'); // Smooth update without animation
    }
  }
}

function updateSubjectProgress() {
  const subjectProgress = document.getElementById('subjectProgress');
  if (!subjectProgress) return;
  
  // Generate subject progress based on user activity
  const subjects = [
    { name: 'Mathematics', progress: Math.min(85 + (currentUser?.stats.questionsAsked || 0) * 2, 100) },
    { name: 'Physics', progress: Math.min(60 + (currentUser?.stats.totalStudyTime || 0) / 10, 100) },
    { name: 'Chemistry', progress: Math.min(75 + (currentUser?.stats.level || 1) * 5, 100) },
    { name: 'Biology', progress: Math.min(45 + (currentUser?.stats.xpPoints || 0) / 20, 100) },
    { name: 'Computer Science', progress: Math.min(90 + (currentUser?.stats.currentStreak || 0) * 2, 100) }
  ];
  
  subjectProgress.innerHTML = subjects.map(subject => `
    <div class="progress-item" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="color: white; font-weight: 600;">${subject.name}</span>
        <span style="color: rgba(255,255,255,0.7); font-size: 14px;">${Math.floor(subject.progress)}%</span>
      </div>
      <div class="progress-bar" style="width: 100%; height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden;">
        <div class="progress-fill" style="width: ${subject.progress}%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 4px; transition: width 0.8s ease;"></div>
      </div>
    </div>
  `).join('');
}

// === GAMIFICATION SYSTEM ===
function calculateStreakBonus() {
  if (!currentUser) return 1.0;
  
  const streak = currentUser.stats.currentStreak;
  if (streak >= 30) return 2.5; // 150% bonus
  if (streak >= 21) return 2.0; // 100% bonus
  if (streak >= 14) return 1.75; // 75% bonus
  if (streak >= 7) return 1.5; // 50% bonus
  if (streak >= 3) return 1.25; // 25% bonus
  return 1.0; // No bonus
}

function updateStreak() {
  const lastActivity = getStorageItem('lastActivityDate');
  const today = new Date().toDateString();
  
  if (lastActivity !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (lastActivity === yesterday.toDateString()) {
      // Consecutive day - increase streak
      if (currentUser) {
        currentUser.stats.currentStreak++;
        updateUserInterface();
        updateStoredUser();
        
        // Show streak milestone notifications
        const streak = currentUser.stats.currentStreak;
        if ([3, 7, 14, 21, 30].includes(streak)) {
          showNotification('achievement', `${streak} Day Streak!`, `Amazing consistency! Keep it up!`);
        }
      }
    } else if (lastActivity && lastActivity !== today) {
      // Streak broken
      if (currentUser && currentUser.stats.currentStreak > 0) {
        currentUser.stats.currentStreak = 1;
        updateUserInterface();
        updateStoredUser();
        showNotification('info', 'Streak Reset', 'New day, fresh start! Let\'s build that streak again.');
      }
    } else if (!lastActivity) {
      // First day
      if (currentUser) {
        currentUser.stats.currentStreak = 1;
        updateUserInterface();
        updateStoredUser();
      }
    }
    
    setStorageItem('lastActivityDate', today);
  }
}

function checkLevelUp() {
  if (!currentUser) return;
  
  const currentXP = currentUser.stats.xpPoints;
  const currentLevel = currentUser.stats.level;
  const xpForNextLevel = (currentLevel * 100) + (currentLevel * 50); // Progressive XP requirement
  
  if (currentXP >= xpForNextLevel) {
    currentUser.stats.level++;
    currentUser.stats.xpPoints = currentXP - xpForNextLevel;
    updateUserInterface();
    updateStoredUser();
    
    showLevelUpModal(currentUser.stats.level);
    playNotificationSound();
  }
}

function showLevelUpModal(newLevel) {
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000; animation: fadeIn 0.3s ease-out;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 20px; padding: 40px; max-width: 400px; width: 90%; text-align: center; animation: scaleIn 0.3s ease-out; position: relative; overflow: hidden;">
        <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 50%); animation: rotate 20s linear infinite;"></div>
        <div style="position: relative; z-index: 1;">
          <div style="font-size: 80px; margin-bottom: 20px; animation: bounce 0.6s ease-out;">🎉</div>
          <h2 style="color: white; margin-bottom: 12px; font-size: 28px;">Level Up!</h2>
          <div style="font-size: 48px; font-weight: 900; color: #fbbf24; margin-bottom: 16px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
            Level ${newLevel}
          </div>
          <p style="color: rgba(255,255,255,0.9); margin-bottom: 20px; font-size: 16px;">
            Congratulations! You've reached a new level through your dedication to learning.
          </p>
          <div style="background: rgba(255,255,255,0.2); border-radius: 15px; padding: 16px; margin-bottom: 20px;">
            <div style="color: white; font-weight: 600; margin-bottom: 8px;">New Benefits Unlocked:</div>
            <div style="color: rgba(255,255,255,0.8); font-size: 14px;">
              • Higher XP multipliers<br>
              • Advanced quiz difficulties<br>
              • Exclusive achievements
            </div>
          </div>
          <button class="btn" onclick="this.closest('[style*=position]').remove()" style="background: white; color: #6366f1; border: none; padding: 12px 24px; border-radius: 10px; font-weight: 700;">
            Continue Learning!
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  setTimeout(() => {
    if (modal.parentElement) modal.remove();
  }, 15000);
}

function checkAchievements() {
  if (!currentUser) return;
  
  const newAchievements = [];
  const stats = currentUser.stats;
  
  // Check achievement conditions
  const achievementChecks = [
    {
      id: 'first_steps',
      condition: stats.questionsAsked >= 1,
      title: 'First Steps',
      description: 'Asked your first question',
      icon: '🎯',
      xp: 10
    },
    {
      id: 'study_streak_7',
      condition: stats.currentStreak >= 7,
      title: 'Weekly Warrior',
      description: '7 days of continuous learning',
      icon: '📚',
      xp: 100
    },
    {
      id: 'study_machine',
      condition: stats.totalStudyTime >= 120,
      title: 'Study Machine',
      description: 'Studied for 2+ hours total',
      icon: '🔥',
      xp: 75
    },
    {
      id: 'level_up_5',
      condition: stats.level >= 5,
      title: 'Rising Star',
      description: 'Reached Level 5',
      icon: '🚀',
      xp: 150
    },
    {
      id: 'consistent_learner',
      condition: stats.questionsAsked >= 25,
      title: 'Consistent Learner',
      description: 'Asked 25 questions',
      icon: '📈',
      xp: 125
    }
  ];
  
  achievementChecks.forEach(achievement => {
    if (achievement.condition && !hasAchievement(achievement.id)) {
      newAchievements.push(achievement);
    }
  });
  
  // Award new achievements
  newAchievements.forEach(achievement => {
    awardAchievement(achievement);
  });
}

function hasAchievement(achievementId) {
  const achievements = getStorageItem('userAchievements');
  if (!achievements) return false;
  
  try {
    const parsedAchievements = JSON.parse(achievements);
    return parsedAchievements.includes(achievementId);
  } catch (e) {
    return false;
  }
}

function awardAchievement(achievement) {
  // Add to user achievements
  let achievements = getStorageItem('userAchievements');
  try {
    achievements = achievements ? JSON.parse(achievements) : [];
  } catch (e) {
    achievements = [];
  }
  
  achievements.push(achievement.id);
  setStorageItem('userAchievements', JSON.stringify(achievements));
  
  // Award XP
  if (currentUser) {
    currentUser.stats.xpPoints += achievement.xp;
    updateUserInterface();
    updateStoredUser();
    checkLevelUp();
  }
  
  // Show achievement notification
  setTimeout(() => {
    showAchievementUnlock(achievement);
  }, 500);
  
  // Refresh achievements display
  loadAchievements();
}

function showAchievementUnlock(achievement) {
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000; animation: fadeIn 0.3s ease-out;">
      <div style="background: linear-gradient(135deg, #10b981, #059669); border-radius: 20px; padding: 40px; max-width: 400px; width: 90%; text-align: center; animation: scaleIn 0.3s ease-out; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
        <div style="font-size: 64px; margin-bottom: 20px; animation: bounce 0.6s ease-out;">${achievement.icon}</div>
        <h2 style="color: white; margin-bottom: 12px; font-size: 24px;">Achievement Unlocked!</h2>
        <h3 style="color: #fbbf24; margin-bottom: 8px; font-size: 20px; font-weight: 700;">${achievement.title}</h3>
        <p style="color: rgba(255,255,255,0.9); margin-bottom: 20px; line-height: 1.4;">${achievement.description}</p>
        <div style="background: rgba(255, 215, 0, 0.2); color: #fbbf24; padding: 8px 16px; border-radius: 20px; display: inline-block; margin-bottom: 20px; font-weight: 600;">+${achievement.xp} XP</div>
        <button class="btn" onclick="this.closest('[style*=position]').remove()" style="background: white; color: #10b981; border: none; padding: 12px 24px; border-radius: 10px; font-weight: 700;">
          Awesome!
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  playNotificationSound();
  
  setTimeout(() => {
    if (modal.parentElement) modal.remove();
  }, 10000);
}

// === NOTIFICATION SYSTEM ===
function showNotification(type, title, message) {
  const container = document.getElementById('notificationContainer');
  if (!container) return;
  
  const notification = document.createElement('div');
  
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
    achievement: '🏆'
  };
  
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
    achievement: '#f59e0b'
  };
  
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <div class="notification-icon" style="background: ${colors[type]}; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; flex-shrink: 0;">${icons[type] || 'ℹ'}</div>
    <div class="notification-content" style="flex: 1; margin-left: 12px;">
      <div class="notification-title" style="color: var(--text-primary); font-weight: 600; font-size: 14px; margin-bottom: 2px;">${title}</div>
      <div class="notification-text" style="color: var(--text-secondary); font-size: 12px; line-height: 1.3;">${message}</div>
    </div>
    <button class="notification-close" onclick="this.parentElement.remove()" style="background: none; border: none; color: var(--text-secondary); font-size: 16px; cursor: pointer; padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">×</button>
  `;
  
  notification.style.cssText = `
    display: flex;
    align-items: flex-start;
    background: var(--bg-primary);
    border: 1px solid rgba(255,255,255,0.1);
    border-left: 4px solid ${colors[type]};
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 8px;
    animation: slideInRight 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  
  container.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentElement) {
      notification.style.animation = 'slideOutRight 0.3s ease-in forwards';
      setTimeout(() => {
        if (notification.parentElement) notification.remove();
      }, 300);
    }
  }, 5000);
}

function playNotificationSound() {
  const audio = document.getElementById('notificationSound');
  if (audio && currentUser?.preferences?.soundEffects !== false) {
    audio.play().catch(e => console.log('Could not play notification sound'));
  }
}

// === UTILITY FUNCTIONS ===
function updateStoredUser() {
  if (currentUser) {
    setStorageItem('currentUser', JSON.stringify(currentUser));
  }
}

function loadDraftMessage() {
  const draft = getStorageItem('studyBuddyDraft');
  if (draft) {
    const input = document.getElementById('userInput');
    if (input) {
      input.value = draft;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
  }
}

function enableAutoSave() {
  setInterval(() => {
    if (currentUser) {
      updateStoredUser();
    }
  }, 30000);
}

// === DATA EXPORT ===
async function exportUserData() {
  if (!currentUser) {
    showNotification('error', 'Export Failed', 'No user data to export');
    return;
  }
  
  const userData = {
    user: currentUser,
    achievements: getStorageItem('userAchievements') || '[]',
    quizHistory: getStorageItem('quizHistory') || '[]',
    studySessions: getStorageItem('studySessions') || '[]',
    settings: getStorageItem('userSettings') || '{}',
    exportDate: new Date().toISOString(),
    version: '1.0'
  };
  
  try {
    const dataStr = JSON.stringify(userData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `studybuddy-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('success', 'Export Complete', 'Your data has been downloaded');
  } catch (error) {
    console.error('Export error:', error);
    showNotification('error', 'Export Error', 'Failed to export data');
  }
}

// === HELP SYSTEM ===
function showHelp() {
  const helpModal = document.createElement('div');
  helpModal.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;">
      <div style="background: var(--bg-primary); border-radius: 16px; padding: 40px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto;">
        <h2 style="color: var(--text-primary); margin-bottom: 24px; text-align: center;">StudyBuddy AI Help Guide</h2>
        
        <div style="color: var(--text-secondary); line-height: 1.6;">
          <div style="margin-bottom: 24px;">
            <h3 style="color: var(--text-primary); margin: 0 0 12px 0; font-size: 18px;">Getting Started</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li>Ask questions in natural language about any academic subject</li>
              <li>Take adaptive quizzes to test your knowledge</li>
              <li>Use the study timer for focused learning sessions</li>
              <li>Track your progress and earn achievements</li>
            </ul>
          </div>
          
          <div style="margin-bottom: 24px;">
            <h3 style="color: var(--text-primary); margin: 0 0 12px 0; font-size: 18px;">Main Features</h3>
            <div style="display: grid; gap: 12px;">
              <div><strong style="color: #6366f1;">AI Chat:</strong> Get explanations, solve problems, receive study guidance</div>
              <div><strong style="color: #10b981;">Quizzes:</strong> Adaptive difficulty based on your level and performance</div>
              <div><strong style="color: #f59e0b;">Study Timer:</strong> Pomodoro technique with session tracking</div>
              <div><strong style="color: #8b5cf6;">Progress:</strong> Visual analytics of your learning journey</div>
              <div><strong style="color: #ef4444;">Achievements:</strong> Gamification system with XP and levels</div>
            </div>
          </div>
          
          <div style="margin-bottom: 24px;">
            <h3 style="color: var(--text-primary); margin: 0 0 12px 0; font-size: 18px;">Keyboard Shortcuts</h3>
            <div style="display: grid; gap: 8px; background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
              <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Ctrl/Cmd + K</kbd> Focus chat input</div>
              <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Enter</kbd> Send message</div>
              <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Shift + Enter</kbd> New line in message</div>
              <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Escape</kbd> Clear input field</div>
            </div>
          </div>
          
          <div style="margin-bottom: 24px;">
            <h3 style="color: var(--text-primary); margin: 0 0 12px 0; font-size: 18px;">Tips for Best Results</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li>Be specific in your questions for detailed explanations</li>
              <li>Use the study timer regularly to build consistent habits</li>
              <li>Take quizzes to identify areas that need more practice</li>
              <li>Maintain daily streaks for bonus XP multipliers</li>
              <li>Export your data regularly to backup your progress</li>
            </ul>
          </div>
        </div>
        
        <div style="text-align: center; margin-top: 32px;">
          <button class="btn" onclick="this.closest('[style*=position]').remove()" style="min-width: 120px;">
            Got it!
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(helpModal);
}

// === VISUAL EFFECTS ===
function addFloatingAnimationStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes float-up {
      to {
        transform: translateY(-100vh) translateX(-50px);
        opacity: 0;
      }
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes scaleIn {
      from { transform: scale(0.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    
    @keyframes bounce {
      0%, 20%, 53%, 80%, 100% { transform: translate3d(0,0,0); }
      40%, 43% { transform: translate3d(0, -15px, 0); }
      70% { transform: translate3d(0, -7px, 0); }
      90% { transform: translate3d(0, -2px, 0); }
    }
    
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    
    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    
    @keyframes pulse {
      0%, 100% { transform: scaleY(1); opacity: 0.5; }
      50% { transform: scaleY(1.5); opacity: 1; }
    }
    
    @keyframes slideInRight {
      from { 
        transform: translateX(100%);
        opacity: 0;
      }
      to { 
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOutRight {
      from { 
        transform: translateX(0);
        opacity: 1;
      }
      to { 
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

function createParticle() {
  const particle = document.createElement('div');
  particle.style.cssText = `
    position: fixed;
    width: 4px;
    height: 4px;
    background: rgba(99, 102, 241, 0.6);
    border-radius: 50%;
    pointer-events: none;
    z-index: -1;
    left: ${Math.random() * 100}vw;
    top: 100vh;
    animation: float-up ${4 + Math.random() * 3}s linear forwards;
  `;
  
  document.body.appendChild(particle);
  
  setTimeout(() => {
    if (particle.parentElement) particle.remove();
  }, 7000);
}

function initializeVisualEffects() {
  // Create particles occasionally
  setInterval(createParticle, 4000);
  
  // Update progress displays
  setTimeout(() => {
    updateSubjectProgress();
    loadAchievements();
  }, 1000);
}

// === PWA SUPPORT ===
function checkPWASupport() {
  if ('serviceWorker' in navigator) {
    registerServiceWorker();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker registered successfully:', registration);
      })
      .catch(error => {
        console.log('Service Worker registration failed:', error);
      });
  }
}

// === ERROR HANDLING ===
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  showNotification('error', 'Application Error', 'Something went wrong. The app is still functional.');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// === PERFORMANCE MONITORING ===
function trackPerformance() {
  if ('performance' in window) {
    const perfData = performance.getEntriesByType('navigation')[0];
    if (perfData) {
      console.log('Page load time:', perfData.loadEventEnd - perfData.loadEventStart, 'ms');
    }
  }
}

// === SETTINGS MANAGEMENT ===
function getUserSettings() {
  const settings = getStorageItem('userSettings');
  try {
    return settings ? JSON.parse(settings) : {
      notifications: true,
      soundEffects: true,
      autoSave: true,
      theme: 'dark',
      studyReminders: true
    };
  } catch (e) {
    return {
      notifications: true,
      soundEffects: true,
      autoSave: true,
      theme: 'dark',
      studyReminders: true
    };
  }
}

function saveUserSettings(newSettings) {
  const currentSettings = getUserSettings();
  const updatedSettings = { ...currentSettings, ...newSettings };
  setStorageItem('userSettings', JSON.stringify(updatedSettings));
  
  // Update user preferences
  if (currentUser) {
    currentUser.preferences = { ...currentUser.preferences, ...newSettings };
    updateStoredUser();
  }
}

// === ANALYTICS ===
function getStudyAnalytics() {
  const sessions = getStorageItem('studySessions');
  if (!sessions) return { totalSessions: 0, averageLength: 0, totalTime: 0 };
  
  try {
    const parsedSessions = JSON.parse(sessions);
    const totalTime = parsedSessions.reduce((sum, session) => sum + session.duration, 0);
    return {
      totalSessions: parsedSessions.length,
      averageLength: parsedSessions.length > 0 ? Math.floor(totalTime / parsedSessions.length) : 0,
      totalTime: totalTime
    };
  } catch (e) {
    return { totalSessions: 0, averageLength: 0, totalTime: 0 };
  }
}

function getQuizAnalytics() {
  const quizHistory = getStorageItem('quizHistory');
  if (!quizHistory) return { totalQuizzes: 0, averageScore: 0, bestScore: 0 };
  
  try {
    const history = JSON.parse(quizHistory);
    const totalScore = history.reduce((sum, quiz) => sum + quiz.score, 0);
    const bestScore = Math.max(...history.map(quiz => quiz.score), 0);
    
    return {
      totalQuizzes: history.length,
      averageScore: history.length > 0 ? Math.floor(totalScore / history.length) : 0,
      bestScore: bestScore
    };
  } catch (e) {
    return { totalQuizzes: 0, averageScore: 0, bestScore: 0 };
  }
}

// === INITIALIZATION ===
window.addEventListener('load', () => {
  trackPerformance();
  console.log('🎓 StudyBuddy AI - Complete Enhanced Learning Platform Loaded!');
  console.log('✨ Features: Authentication, AI Chat, Adaptive Quizzes, Study Timer, Progress Analytics, Achievement System, PWA Support');
});

// Global exposure for onclick handlers
window.showLoginForm = showLoginForm;
window.showRegisterForm = showRegisterForm;
window.login = login;
window.register = register;
window.logout = logout;
window.quickQuestion = quickQuestion;
window.sendMessage = sendMessage;
window.copyCode = copyCode;
window.toggleVoiceRecording = toggleVoiceRecording;
window.openFileUpload = openFileUpload;
window.handleFileUpload = handleFileUpload;
window.toggleTheme = toggleTheme;
window.generateQuiz = generateQuiz;
window.selectAnswer = selectAnswer;
window.nextQuestion = nextQuestion;
window.previousQuestion = previousQuestion;
window.setTimerPreset = setTimerPreset;
window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resetTimer = resetTimer;
window.showSection = showSection;
window.exportUserData = exportUserData;
window.showHelp = showHelp;

console.log('🚀 StudyBuddy AI Enhanced - Complete version initialized successfully!');