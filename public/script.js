// StudyBuddy AI - Complete Enhanced Learning Platform
// Combined and optimized version with all features

// Disable Service Worker immediately to fix CDN loading issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister().then(() => {
        console.log('🔧 Service Worker unregistered to fix CDN loading');
      });
    }
  });
}

// === GLOBAL VARIABLES ===
let currentUser = null;
let authToken = null;
let socket = null;
let studyTimer = null;
let timerInterval = null;
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

// === SPEECH-TO-TEXT VOICE RECORDING ===
let speechRecognition = null;
let isListening = false;

// Initialize Speech Recognition
function initializeSpeechRecognition() {
  console.log('🔍 Checking speech recognition support...');
  console.log('- window.SpeechRecognition:', typeof window.SpeechRecognition);
  console.log('- window.webkitSpeechRecognition:', typeof window.webkitSpeechRecognition);
  console.log('- User agent:', navigator.userAgent);
  
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    console.log('✅ Speech Recognition API detected');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    console.log('🔧 Using SpeechRecognition constructor:', SpeechRecognition);
    speechRecognition = new SpeechRecognition();
    
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = getStorageItem('speechLang') || 'en-US';
    speechRecognition.maxAlternatives = 1;
    
    // Auto-detect silence and stop after 5 seconds of no speech
    let silenceTimer = null;
    
    speechRecognition.onstart = () => {
      console.log('🎤 Speech recognition started');
      isListening = true;
      updateVoiceUI(true);
      showVoiceRecordingIndicator();
      showNotification('🎤 Listening...', 'info');
    };
    
    speechRecognition.onresult = (event) => {
      // Clear silence timer when speech is detected
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      
      let interimTranscript = '';
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Update the input field with the transcript
      const userInput = document.getElementById('userInput');
      if (userInput) {
        if (finalTranscript) {
          userInput.value = (userInput.value + ' ' + finalTranscript).trim();
          // Auto-resize textarea
          userInput.style.height = 'auto';
          userInput.style.height = userInput.scrollHeight + 'px';
          
          // Set silence timer after final transcript
          silenceTimer = setTimeout(() => {
            if (isListening) {
              console.log('🔇 Auto-stopping due to silence');
              stopVoiceRecording();
            }
          }, 3000); // Stop after 3 seconds of silence
        }
        
        // Show interim results in placeholder or as overlay
        if (interimTranscript) {
          updateInterimTranscript(interimTranscript);
        }
      }
      
      if (finalTranscript) {
        console.log('🎯 Final transcript:', finalTranscript);
      }
    };
    
    speechRecognition.onerror = (event) => {
      console.error('❌ Speech recognition error:', event.error);
      let errorMessage = 'Speech recognition error occurred.';
      
      switch (event.error) {
        case 'no-speech':
          errorMessage = 'No speech detected. Please try again.';
          break;
        case 'audio-capture':
          errorMessage = 'Microphone not accessible. Check permissions.';
          break;
        case 'not-allowed':
          errorMessage = 'Microphone permission denied. Please allow access and reload the page.';
          break;
        case 'network':
          errorMessage = 'Network error. Check your internet connection.';
          break;
        case 'service-not-allowed':
          errorMessage = 'Speech recognition service not available.';
          break;
        case 'aborted':
          errorMessage = 'Speech recognition was aborted.';
          break;
        default:
          errorMessage = `Speech recognition error: ${event.error}`;
      }
      
      showNotification(errorMessage, 'error');
      isListening = false;
      updateVoiceUI(false);
      hideVoiceRecordingIndicator();
      clearInterimTranscript();
    };
    
    speechRecognition.onend = () => {
      console.log('🔇 Speech recognition ended');
      isListening = false;
      updateVoiceUI(false);
      hideVoiceRecordingIndicator();
      clearInterimTranscript();
    };
    
    return true;
  } else {
    console.warn('⚠️ Speech Recognition not supported');
    return false;
  }
}

async function toggleVoiceRecording() {
  console.log('🎤 toggleVoiceRecording called, isListening:', isListening);
  
  // Show immediate feedback that button was clicked
  showNotification('🎤 Microphone button clicked!', 'info');
  
  // Initialize speech recognition if not already done
  if (!speechRecognition) {
    console.log('🔧 Initializing speech recognition...');
    if (!initializeSpeechRecognition()) {
      console.error('❌ Speech recognition not supported');
      showNotification('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.', 'error');
      return;
    }
  }
  
  if (!isListening) {
    console.log('▶️ Starting voice recording');
    startVoiceRecording();
  } else {
    console.log('⏹️ Stopping voice recording');
    stopVoiceRecording();
  }
}

function startVoiceRecording() {
  console.log('🚀 startVoiceRecording called, speechRecognition:', speechRecognition);
  try {
    if (speechRecognition) {
      console.log('📡 Starting speech recognition...');
      
      // Request microphone permission first
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(() => {
            console.log('🎤 Microphone permission granted');
            speechRecognition.start();
          })
          .catch((error) => {
            console.error('❌ Microphone permission denied:', error);
            showNotification('Microphone permission is required for speech recognition. Please allow access and try again.', 'error');
          });
      } else {
        // Fallback for older browsers
        speechRecognition.start();
      }
    } else {
      console.error('❌ speechRecognition is null');
      showNotification('Speech recognition not initialized. Please try again.', 'error');
    }
  } catch (error) {
    console.error('❌ Error starting speech recognition:', error);
    
    if (error.name === 'InvalidStateError') {
      showNotification('Speech recognition is already running. Please wait and try again.', 'warning');
    } else {
      showNotification('Could not start speech recognition. Please try again.', 'error');
    }
  }
}

function stopVoiceRecording() {
  if (speechRecognition && isListening) {
    speechRecognition.stop();
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

// Update voice button UI
function updateVoiceUI(isActive) {
  const voiceIcon = document.getElementById('voiceIcon');
  const voiceButton = document.querySelector('.voice-button');
  
  if (voiceIcon && voiceButton) {
    if (isActive) {
      voiceIcon.className = 'fas fa-stop';
      voiceButton.classList.add('recording');
      voiceButton.style.background = '#ef4444';
      voiceButton.style.color = 'white';
    } else {
      voiceIcon.className = 'fas fa-microphone';
      voiceButton.classList.remove('recording');
      voiceButton.style.background = '';
      voiceButton.style.color = '';
    }
  }
}

// Show interim transcript as overlay
function updateInterimTranscript(interimText) {
  let overlay = document.querySelector('.interim-transcript');
  const inputWrapper = document.querySelector('.input-wrapper');
  
  if (!overlay && inputWrapper) {
    overlay = document.createElement('div');
    overlay.className = 'interim-transcript';
    overlay.style.cssText = `
      position: absolute;
      top: 50%;
      left: 12px;
      right: 80px;
      transform: translateY(-50%);
      color: #6366f1;
      opacity: 0.7;
      font-style: italic;
      pointer-events: none;
      z-index: 10;
      background: rgba(99, 102, 241, 0.1);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
    `;
    inputWrapper.appendChild(overlay);
  }
  
  if (overlay) {
    overlay.textContent = interimText;
  }
}

// Clear interim transcript overlay
function clearInterimTranscript() {
  const overlay = document.querySelector('.interim-transcript');
  if (overlay) {
    overlay.remove();
  }
}

// Add keyboard shortcut for voice recording (Ctrl/Cmd + Shift + V)
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'V') {
    event.preventDefault();
    toggleVoiceRecording();
  }
});

// Test function to verify button click
function testVoiceButton() {
  console.log('🧪 Voice button test clicked!');
  alert('Voice button is working! Speech recognition will be initialized.');
}

// Debug function to check speech recognition status
function debugSpeechRecognition() {
  console.log('🔍 Speech Recognition Debug Info:');
  console.log('- speechRecognition object:', speechRecognition);
  console.log('- isListening:', isListening);
  console.log('- SpeechRecognition supported:', 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  console.log('- Voice button element:', document.querySelector('.voice-button'));
  console.log('- User agent:', navigator.userAgent);
  console.log('- Protocol:', window.location.protocol);
  console.log('- Host:', window.location.host);
  
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    console.log('✅ Speech Recognition API is available');
    
    // Test microphone permissions
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => {
          console.log('✅ Microphone permission granted');
        })
        .catch((error) => {
          console.log('❌ Microphone permission denied:', error);
        });
    }
  } else {
    console.log('❌ Speech Recognition API is NOT available');
    console.log('💡 Try using Chrome, Edge, or Safari for speech recognition support');
  }
  
  // Test button click
  const voiceButton = document.querySelector('.voice-button');
  if (voiceButton) {
    console.log('✅ Voice button found');
    console.log('- Button onclick:', voiceButton.onclick);
    console.log('- Button disabled:', voiceButton.disabled);
    console.log('- Button style display:', getComputedStyle(voiceButton).display);
  } else {
    console.log('❌ Voice button NOT found');
  }
}

// Comprehensive test function
function testSpeechRecognition() {
  console.log('🧪 Running comprehensive speech recognition test...');
  debugSpeechRecognition();
  
  // Try to initialize speech recognition
  if (!speechRecognition) {
    console.log('🔧 Attempting to initialize speech recognition...');
    const result = initializeSpeechRecognition();
    console.log('Initialization result:', result);
  }
  
  // Test the toggle function
  console.log('🎤 Testing toggleVoiceRecording function...');
  try {
    toggleVoiceRecording();
  } catch (error) {
    console.error('❌ Error testing toggleVoiceRecording:', error);
  }
}

// Initialize speech recognition on page load
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM Content Loaded - Initializing speech recognition');
  
  // Find the voice button
  const voiceButton = document.querySelector('.voice-button');
  console.log('🔍 Voice button found:', voiceButton);
  
  // Initialize speech recognition if supported
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    console.log('✅ Speech Recognition is supported');
    
    // Add tooltip to voice button
    if (voiceButton) {
      voiceButton.title = 'Click to start voice input (Ctrl+Shift+V)';
      console.log('📝 Tooltip added to voice button');
    }
  } else {
    console.warn('⚠️ Speech Recognition not supported in this browser');
    // Optionally disable the voice button
    if (voiceButton) {
      voiceButton.style.opacity = '0.5';
      voiceButton.title = 'Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.';
      voiceButton.disabled = true;
      console.log('❌ Voice button disabled due to lack of support');
    }
  }
  
  // Add click event listener as backup
  if (voiceButton) {
    voiceButton.addEventListener('click', (e) => {
      console.log('🖱️ Voice button clicked via event listener');
      e.preventDefault();
      toggleVoiceRecording();
    });
  }
});

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

// === ADAPTIVE QUIZ SYSTEM ===
let quizDifficultyProgression = JSON.parse(localStorage.getItem('chasejee-quiz-difficulty')) || {};

async function generateQuiz() {
  const subjectSelect = document.getElementById('quizSubject');
  const subject = subjectSelect ? subjectSelect.value : 'mathematics';
  const container = document.getElementById('quizContainer');
  
  if (container) {
    const currentLevel = getDifficultyLevel(subject);
    container.innerHTML = `
      <div class="loading" style="text-align: center; padding: 40px;">
        <div class="spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
        <p style="color: var(--text-secondary);">🎯 Generating ${subject} quiz...</p>
        <p style="color: #6366f1; font-weight: 600; margin-top: 8px;">📚 Level ${currentLevel} | ${getDifficultyName(subject)}</p>
        <p style="color: var(--text-secondary); font-size: 14px; margin-top: 8px;">Using enhanced question bank</p>
      </div>
    `;
  }
  
  try {
    // Check if user is authenticated for backend integration
    if (authToken) {
      const difficulty = getAdaptiveDifficulty(subject);
      const difficultyLevel = getDifficultyLevel(subject);
      
      // Try to create quiz via backend API
      const response = await fetch('/api/quiz/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          subject: subject,
          topic: subject,
          difficulty: difficulty,
          questionCount: 5
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Set up current quiz with backend data
        currentQuiz = {
          quizId: data.quiz.id,
          subject: data.quiz.subject,
          difficulty: data.quiz.difficulty,
          difficultyLevel: difficultyLevel,
          questions: data.quiz.questions.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options,
            correct: q.options[0], // Will be corrected during submission
            explanation: q.explanation || `Detailed explanation for: ${q.question}`
          })),
          userAnswers: [],
          backendQuizId: data.quiz.id,
          isBackendQuiz: true
        };
        
        currentQuestionIndex = 0;
        displayQuestion();
        showNotification('success', 'Quiz Ready!', `${subject} quiz with ${data.quiz.totalQuestions} questions`);
        return;
      }
    }
    
    // Fallback to enhanced frontend quiz generation
    setTimeout(() => {
      const difficulty = getAdaptiveDifficulty(subject);
      const difficultyLevel = getDifficultyLevel(subject);
      
      currentQuiz = {
        quizId: 'enhanced-quiz-' + Date.now(),
        subject: subject,
        difficulty: difficulty,
        difficultyLevel: difficultyLevel,
        questions: generateQuizQuestions(subject, difficulty, difficultyLevel),
        userAnswers: [],
        isBackendQuiz: false
      };
      currentQuestionIndex = 0;
      displayQuestion();
      showNotification('info', 'Quiz Generated', `Enhanced ${subject} quiz ready!`);
    }, 1500);
    
  } catch (error) {
    console.error('Quiz generation error:', error);
    
    // Fallback to frontend generation
    setTimeout(() => {
      const difficulty = getAdaptiveDifficulty(subject);
      const difficultyLevel = getDifficultyLevel(subject);
      
      currentQuiz = {
        quizId: 'fallback-quiz-' + Date.now(),
        subject: subject,
        difficulty: difficulty,
        difficultyLevel: difficultyLevel,
        questions: generateQuizQuestions(subject, difficulty, difficultyLevel),
        userAnswers: [],
        isBackendQuiz: false
      };
      currentQuestionIndex = 0;
      displayQuestion();
    }, 1000);
  }
}

function getAdaptiveDifficulty(subject) {
  const progression = quizDifficultyProgression[subject] || { level: 1, completedQuizzes: 0, averageAccuracy: 0 };
  
  // Adaptive difficulty based on level and performance
  if (progression.level <= 2) {
    return 'beginner';
  } else if (progression.level <= 5) {
    return 'intermediate';
  } else if (progression.level <= 8) {
    return 'advanced';
  } else {
    return 'expert'; // New expert level for very advanced students
  }
}

function getDifficultyLevel(subject) {
  const progression = quizDifficultyProgression[subject] || { level: 1, completedQuizzes: 0, averageAccuracy: 0 };
  return progression.level;
}

function getDifficultyName(subject) {
  const difficulty = getAdaptiveDifficulty(subject);
  const level = getDifficultyLevel(subject);
  
  const names = {
    'beginner': `Beginner (Level ${level})`,
    'intermediate': `Intermediate (Level ${level})`,
    'advanced': `Advanced (Level ${level})`,
    'expert': `Expert (Level ${level})`
  };
  
  return names[difficulty] || `Level ${level}`;
}

function getUserDifficulty() {
  // Keep for backward compatibility, but now we use adaptive difficulty
  if (!currentUser) return 'intermediate';
  const level = currentUser.stats.level;
  if (level <= 2) return 'beginner';
  if (level <= 5) return 'intermediate';
  return 'advanced';
}

function generateQuizQuestions(subject, difficulty, difficultyLevel = 1) {
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
        },
        {
          question: "What is the value of π (pi) approximately?",
          options: ["3.14", "2.71", "1.41", "4.14"],
          correct: "3.14",
          explanation: "π (pi) is approximately 3.14159... but 3.14 is the common approximation"
        },
        {
          question: "What is 2³ (2 to the power of 3)?",
          options: ["6", "8", "9", "4"],
          correct: "8",
          explanation: "2³ = 2 × 2 × 2 = 8"
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
        },
        {
          question: "What is the speed of light in vacuum?",
          options: ["3 × 10⁸ m/s", "3 × 10⁶ m/s", "3 × 10¹⁰ m/s", "3 × 10⁴ m/s"],
          correct: "3 × 10⁸ m/s",
          explanation: "The speed of light in vacuum is approximately 3 × 10⁸ meters per second"
        },
        {
          question: "What happens to the volume of a gas when temperature increases (at constant pressure)?",
          options: ["Increases", "Decreases", "Remains same", "Becomes zero"],
          correct: "Increases",
          explanation: "According to Charles's Law, volume increases with temperature at constant pressure"
        },
        {
          question: "Which of these is a renewable source of energy?",
          options: ["Solar", "Coal", "Oil", "Natural Gas"],
          correct: "Solar",
          explanation: "Solar energy is renewable as it comes from the sun which is a continuous source"
        }
      ],
      chemistry: [
        {
          question: "What is the chemical symbol for water?",
          options: ["H₂O", "CO₂", "NaCl", "O₂"],
          correct: "H₂O",
          explanation: "Water consists of 2 hydrogen atoms and 1 oxygen atom, hence H₂O"
        },
        {
          question: "What is the atomic number of carbon?",
          options: ["6", "12", "8", "14"],
          correct: "6",
          explanation: "Carbon has 6 protons in its nucleus, so its atomic number is 6"
        },
        {
          question: "Which gas makes up most of Earth's atmosphere?",
          options: ["Nitrogen", "Oxygen", "Carbon dioxide", "Argon"],
          correct: "Nitrogen",
          explanation: "Nitrogen makes up about 78% of Earth's atmosphere"
        },
        {
          question: "What is the pH of pure water?",
          options: ["7", "0", "14", "1"],
          correct: "7",
          explanation: "Pure water has a neutral pH of 7"
        },
        {
          question: "What is the chemical formula for table salt?",
          options: ["NaCl", "KCl", "CaCl₂", "MgCl₂"],
          correct: "NaCl",
          explanation: "Table salt is sodium chloride with the formula NaCl"
        }
      ],
      biology: [
        {
          question: "What is the powerhouse of the cell?",
          options: ["Mitochondria", "Nucleus", "Ribosome", "Chloroplast"],
          correct: "Mitochondria",
          explanation: "Mitochondria produce ATP (energy) for the cell, hence called the powerhouse"
        },
        {
          question: "How many chambers does a human heart have?",
          options: ["4", "2", "3", "6"],
          correct: "4",
          explanation: "The human heart has 4 chambers: 2 atria and 2 ventricles"
        },
        {
          question: "What is the basic unit of life?",
          options: ["Cell", "Tissue", "Organ", "Atom"],
          correct: "Cell",
          explanation: "The cell is the smallest structural and functional unit of life"
        },
        {
          question: "Which blood type is known as the universal donor?",
          options: ["O-", "AB+", "A+", "B-"],
          correct: "O-",
          explanation: "O- blood type can be given to anyone, making it the universal donor"
        },
        {
          question: "What is the process by which plants make food?",
          options: ["Photosynthesis", "Respiration", "Digestion", "Fermentation"],
          correct: "Photosynthesis",
          explanation: "Plants use photosynthesis to convert sunlight, water, and CO₂ into glucose"
        }
      ],
      computer_science: [
        {
          question: "What does CPU stand for?",
          options: ["Central Processing Unit", "Computer Personal Unit", "Central Program Unit", "Computer Processing Unit"],
          correct: "Central Processing Unit",
          explanation: "CPU stands for Central Processing Unit, the main processor of a computer"
        },
        {
          question: "Which of these is a programming language?",
          options: ["Python", "HTML", "CSS", "HTTP"],
          correct: "Python",
          explanation: "Python is a high-level programming language used for various applications"
        },
        {
          question: "What does RAM stand for?",
          options: ["Random Access Memory", "Read Access Memory", "Rapid Access Memory", "Remote Access Memory"],
          correct: "Random Access Memory",
          explanation: "RAM stands for Random Access Memory, used for temporary data storage"
        },
        {
          question: "What is the binary representation of decimal number 5?",
          options: ["101", "110", "111", "100"],
          correct: "101",
          explanation: "5 in binary is 101 (1×4 + 0×2 + 1×1 = 4 + 0 + 1 = 5)"
        },
        {
          question: "Which company developed the Java programming language?",
          options: ["Sun Microsystems", "Microsoft", "Apple", "Google"],
          correct: "Sun Microsystems",
          explanation: "Java was originally developed by Sun Microsystems (now owned by Oracle)"
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
        },
        {
          question: "What is the formula for kinetic energy?",
          options: ["½mv²", "mgh", "mc²", "mv"],
          correct: "½mv²",
          explanation: "Kinetic energy is ½mv² where m is mass and v is velocity"
        },
        {
          question: "What is Ohm's law?",
          options: ["V = IR", "P = IV", "E = hf", "F = qE"],
          correct: "V = IR",
          explanation: "Ohm's law states that Voltage equals Current times Resistance"
        }
      ],
      chemistry: [
        {
          question: "What is the molecular formula of glucose?",
          options: ["C₆H₁₂O₆", "C₂H₆O", "CH₄", "CO₂"],
          correct: "C₆H₁₂O₆",
          explanation: "Glucose has the molecular formula C₆H₁₂O₆"
        },
        {
          question: "What is the process of a solid turning directly into gas?",
          options: ["Sublimation", "Evaporation", "Condensation", "Melting"],
          correct: "Sublimation",
          explanation: "Sublimation is the direct transition from solid to gas without liquid phase"
        },
        {
          question: "Which element has the highest electronegativity?",
          options: ["Fluorine", "Oxygen", "Nitrogen", "Chlorine"],
          correct: "Fluorine",
          explanation: "Fluorine has the highest electronegativity value of 4.0"
        }
      ],
      biology: [
        {
          question: "What is the function of ribosomes?",
          options: ["Protein synthesis", "DNA replication", "Lipid synthesis", "Energy production"],
          correct: "Protein synthesis",
          explanation: "Ribosomes are responsible for protein synthesis in cells"
        },
        {
          question: "What is the process of cell division in somatic cells?",
          options: ["Mitosis", "Meiosis", "Binary fission", "Budding"],
          correct: "Mitosis",
          explanation: "Mitosis is the process of cell division in somatic (body) cells"
        },
        {
          question: "Which organ produces insulin?",
          options: ["Pancreas", "Liver", "Kidney", "Stomach"],
          correct: "Pancreas",
          explanation: "Insulin is produced by beta cells in the pancreas"
        }
      ],
      computer_science: [
        {
          question: "What is the time complexity of binary search?",
          options: ["O(log n)", "O(n)", "O(n²)", "O(1)"],
          correct: "O(log n)",
          explanation: "Binary search has logarithmic time complexity O(log n)"
        },
        {
          question: "Which data structure follows LIFO principle?",
          options: ["Stack", "Queue", "Array", "Linked List"],
          correct: "Stack",
          explanation: "Stack follows Last In First Out (LIFO) principle"
        },
        {
          question: "What does SQL stand for?",
          options: ["Structured Query Language", "Simple Query Language", "Standard Query Language", "System Query Language"],
          correct: "Structured Query Language",
          explanation: "SQL stands for Structured Query Language"
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
        },
        {
          question: "What is the relativistic energy-momentum relation?",
          options: ["E² = (pc)² + (mc²)²", "E = mc²", "E = ½mv²", "E = hf"],
          correct: "E² = (pc)² + (mc²)²",
          explanation: "The relativistic energy-momentum relation is E² = (pc)² + (mc²)²"
        }
      ],
      chemistry: [
        {
          question: "What is the hybridization of carbon in benzene?",
          options: ["sp²", "sp³", "sp", "sp³d"],
          correct: "sp²",
          explanation: "Carbon atoms in benzene are sp² hybridized, forming planar structure with 120° bond angles"
        },
        {
          question: "What is the rate law for a second-order reaction A → Products?",
          options: ["Rate = k[A]²", "Rate = k[A]", "Rate = k", "Rate = k[A]³"],
          correct: "Rate = k[A]²",
          explanation: "For a second-order reaction, the rate is proportional to the square of the concentration"
        }
      ],
      biology: [
        {
          question: "What is the central dogma of molecular biology?",
          options: ["DNA → RNA → Protein", "Protein → RNA → DNA", "RNA → DNA → Protein", "DNA → Protein → RNA"],
          correct: "DNA → RNA → Protein",
          explanation: "The central dogma describes the flow of genetic information: DNA → RNA → Protein"
        },
        {
          question: "What is the function of the electron transport chain?",
          options: ["ATP synthesis", "DNA replication", "Protein synthesis", "Lipid synthesis"],
          correct: "ATP synthesis",
          explanation: "The electron transport chain creates a proton gradient used for ATP synthesis"
        }
      ],
      computer_science: [
        {
          question: "What is the worst-case time complexity of QuickSort?",
          options: ["O(n²)", "O(n log n)", "O(n)", "O(log n)"],
          correct: "O(n²)",
          explanation: "QuickSort has O(n²) worst-case time complexity when the pivot is always the smallest or largest element"
        },
        {
          question: "What is a hash collision?",
          options: ["When two keys hash to the same index", "When hash function fails", "When hash table is full", "When key is not found"],
          correct: "When two keys hash to the same index",
          explanation: "A hash collision occurs when two different keys produce the same hash value"
        }
      ]
    },
    expert: {
      mathematics: [
        {
          question: "Find the limit: lim(x→0) [sin(3x) - 3sin(x)] / x³",
          options: ["-9/2", "0", "9/2", "∞"],
          correct: "-9/2",
          explanation: "Using Taylor series expansion: sin(3x) ≈ 3x - (27x³)/6 and sin(x) ≈ x - x³/6. The limit evaluates to -9/2."
        },
        {
          question: "If f(x) = x³ - 6x² + 11x - 6, find the number of real roots.",
          options: ["1", "2", "3", "0"],
          correct: "3",
          explanation: "f(x) = (x-1)(x-2)(x-3), so it has three real roots: x = 1, 2, 3."
        },
        {
          question: "Evaluate ∫₀^π x·sin(x) dx",
          options: ["π", "2π", "π/2", "0"],
          correct: "π",
          explanation: "Using integration by parts: u = x, dv = sin(x)dx. The integral equals π."
        },
        {
          question: "Find the coefficient of x⁵ in the expansion of (1 + x + x²)¹⁰",
          options: ["210", "252", "126", "462"],
          correct: "252",
          explanation: "Using multinomial theorem and generating functions, the coefficient is 252."
        },
        {
          question: "If z = x + iy satisfies |z - 1| = |z + 1|, then z lies on:",
          options: ["Real axis", "Imaginary axis", "Unit circle", "Line y = x"],
          correct: "Imaginary axis",
          explanation: "|z - 1| = |z + 1| represents the perpendicular bisector of points 1 and -1, which is the imaginary axis."
        }
      ],
      physics: [
        {
          question: "A particle in a 1D infinite potential well has energy E₂. What is the probability of finding it in the middle third of the well?",
          options: ["1/3", "0.196", "0.609", "0.5"],
          correct: "0.196",
          explanation: "For n=2 state, ψ₂(x) = √(2/L)sin(2πx/L). Integrating |ψ₂|² from L/3 to 2L/3 gives ≈0.196."
        },
        {
          question: "In special relativity, if a muon has γ = 10, what fraction of its rest mass is its kinetic energy?",
          options: ["9", "10", "0.9", "1"],
          correct: "9",
          explanation: "KE = (γ-1)mc² = 9mc². The kinetic energy is 9 times the rest mass energy."
        },
        {
          question: "For a blackbody at 3000K, at what wavelength is the spectral radiance maximum?",
          options: ["966 nm", "483 nm", "1450 nm", "725 nm"],
          correct: "966 nm",
          explanation: "Using Wien's displacement law: λₘₐₓ = 2.898×10⁻³/T = 2.898×10⁻³/3000 ≈ 966 nm."
        },
        {
          question: "A hydrogen atom transitions from n=4 to n=2. What is the wavelength of emitted photon?",
          options: ["486 nm", "656 nm", "434 nm", "410 nm"],
          correct: "486 nm",
          explanation: "Using Rydberg formula: 1/λ = R(1/2² - 1/4²) = R(3/16). This gives λ ≈ 486 nm (Hβ line)."
        }
      ],
      chemistry: [
        {
          question: "What is the hybridization of the central atom in IF₅?",
          options: ["sp³d", "sp³d²", "sp³", "sp²d"],
          correct: "sp³d²",
          explanation: "IF₅ has 5 bonding pairs and 1 lone pair around I, requiring 6 hybrid orbitals, hence sp³d² hybridization."
        },
        {
          question: "Calculate the pH of 0.1M NH₄Cl solution (Kb for NH₃ = 1.8×10⁻⁵)",
          options: ["5.13", "8.87", "7.00", "4.74"],
          correct: "5.13",
          explanation: "NH₄⁺ is a weak acid. Ka = Kw/Kb = 5.56×10⁻¹⁰. Using Ka expression: pH = ½(pKa - log C) ≈ 5.13."
        },
        {
          question: "For the reaction 2A + B → C, if [A] doubles and [B] triples, rate increases 18-fold. What is the rate law?",
          options: ["Rate = k[A][B]²", "Rate = k[A]²[B]²", "Rate = k[A]²[B]", "Rate = k[A][B]"],
          correct: "Rate = k[A]²[B]²",
          explanation: "If rate = k[A]ᵐ[B]ⁿ, then 18 = 2ᵐ × 3ⁿ. Solving: m = 2, n = 2."
        },
        {
          question: "What is the IUPAC name of the compound with molecular formula C₄H₈O that gives positive Tollens test?",
          options: ["Butanal", "2-Butanone", "Butanol", "2-Methylpropanal"],
          correct: "Butanal",
          explanation: "Positive Tollens test indicates an aldehyde. C₄H₈O aldehyde is butanal (CH₃CH₂CH₂CHO)."
        }
      ],
      biology: [
        {
          question: "In the lac operon, what happens when both glucose and lactose are present?",
          options: ["Operon is fully active", "Operon is inactive", "Partial activation", "CAP-cAMP complex forms"],
          correct: "Partial activation",
          explanation: "Glucose presence reduces cAMP levels, preventing full CAP-cAMP activation despite lactose presence, resulting in partial transcription."
        },
        {
          question: "During meiosis I, crossing over occurs in which phase?",
          options: ["Prophase I", "Metaphase I", "Anaphase I", "Telophase I"],
          correct: "Prophase I",
          explanation: "Crossing over occurs during pachytene stage of prophase I when homologous chromosomes are paired as bivalents."
        },
        {
          question: "What is the net ATP yield from complete oxidation of one glucose molecule in eukaryotes?",
          options: ["30-32", "36-38", "28-30", "32-34"],
          correct: "30-32",
          explanation: "Modern calculations account for proton leak and transport costs: glycolysis (2), citric acid cycle (2), electron transport (26-28)."
        },
        {
          question: "Which enzyme is deficient in phenylketonuria (PKU)?",
          options: ["Phenylalanine hydroxylase", "Tyrosinase", "Homogentisate oxidase", "Fumarylacetoacetase"],
          correct: "Phenylalanine hydroxylase",
          explanation: "PKU is caused by deficiency of phenylalanine hydroxylase, which converts phenylalanine to tyrosine."
        }
      ],
      computer_science: [
        {
          question: "What is the time complexity of finding the median in an unsorted array using quickselect?",
          options: ["O(n) average, O(n²) worst", "O(n log n)", "O(n²)", "O(log n)"],
          correct: "O(n) average, O(n²) worst",
          explanation: "Quickselect has average O(n) time complexity but degrades to O(n²) in worst case with poor pivot selection."
        },
        {
          question: "In a B-tree of order m, what is the minimum number of keys in a non-root internal node?",
          options: ["⌈m/2⌉ - 1", "⌊m/2⌋ - 1", "m - 1", "⌈m/2⌉"],
          correct: "⌈m/2⌉ - 1",
          explanation: "In a B-tree of order m, non-root nodes must have at least ⌈m/2⌉ - 1 keys to maintain balance."
        },
        {
          question: "What is the space complexity of merge sort?",
          options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
          correct: "O(n)",
          explanation: "Merge sort requires O(n) auxiliary space for the temporary arrays used during the merge process."
        },
        {
          question: "In dynamic programming, what is the optimal substructure property?",
          options: ["Optimal solution contains optimal solutions to subproblems", "Subproblems overlap", "Greedy choice works", "Problem can be divided"],
          correct: "Optimal solution contains optimal solutions to subproblems",
          explanation: "Optimal substructure means that optimal solution to the problem contains optimal solutions to its subproblems."
        }
      ]
    }
  };
  
  // Fix fallback logic to use the same subject but different difficulty
  let questions = questionBank[difficulty]?.[subject];
  
  // Adaptive question selection based on difficulty level
  if (difficultyLevel > 1 && questions) {
    // For higher levels, mix in some harder questions
    const baseQuestions = questions.slice();
    const nextDifficultyQuestions = getNextDifficultyQuestions(subject, difficulty, difficultyLevel);
    
    if (nextDifficultyQuestions.length > 0) {
      // Replace some questions with harder ones based on level
      const replacementCount = Math.min(Math.floor(difficultyLevel / 2), 3);
      for (let i = 0; i < replacementCount && i < nextDifficultyQuestions.length; i++) {
        if (baseQuestions.length > i) {
          baseQuestions[baseQuestions.length - 1 - i] = nextDifficultyQuestions[i];
        }
      }
      questions = baseQuestions;
    }
  }
  
  if (!questions || questions.length === 0) {
    // Try intermediate level for the same subject
    questions = questionBank.intermediate?.[subject];
    
    if (!questions || questions.length === 0) {
      // Try beginner level for the same subject
      questions = questionBank.beginner?.[subject];
      
      if (!questions || questions.length === 0) {
        // Last resort: use mathematics beginner questions
        questions = questionBank.beginner.mathematics;
      }
    }
  }
  
  return questions.slice(0, Math.min(5, questions.length)); // Limit to 5 questions
}

// Helper function to get next difficulty questions for mixing
function getNextDifficultyQuestions(subject, currentDifficulty, difficultyLevel) {
  const questionBank = {
    beginner: { /* same structure as above */ },
    intermediate: { /* same structure as above */ },
    advanced: { /* same structure as above */ },
    expert: { /* same structure as above */ }
  };
  
  const difficultyOrder = ['beginner', 'intermediate', 'advanced', 'expert'];
  const currentIndex = difficultyOrder.indexOf(currentDifficulty);
  
  if (currentIndex < difficultyOrder.length - 1) {
    const nextDifficulty = difficultyOrder[currentIndex + 1];
    return questionBank[nextDifficulty]?.[subject] || [];
  }
  
  return [];
}

// Update difficulty progression after quiz completion
function updateDifficultyProgression(subject, accuracy) {
  if (!quizDifficultyProgression[subject]) {
    quizDifficultyProgression[subject] = { level: 1, completedQuizzes: 0, averageAccuracy: 0 };
  }
  
  const progression = quizDifficultyProgression[subject];
  progression.completedQuizzes++;
  
  // Update average accuracy
  progression.averageAccuracy = ((progression.averageAccuracy * (progression.completedQuizzes - 1)) + accuracy) / progression.completedQuizzes;
  
  // Level progression logic
  if (accuracy >= 80 && progression.completedQuizzes >= 2) {
    // High accuracy - advance level
    progression.level = Math.min(progression.level + 1, 15); // Max level 15
  } else if (accuracy >= 70 && progression.completedQuizzes >= 3) {
    // Good accuracy - advance level more slowly
    if (progression.completedQuizzes % 2 === 0) {
      progression.level = Math.min(progression.level + 1, 15);
    }
  } else if (accuracy < 50 && progression.level > 1) {
    // Poor accuracy - consider reducing level
    progression.level = Math.max(progression.level - 1, 1);
  }
  
  // Save progression
  localStorage.setItem('chasejee-quiz-difficulty', JSON.stringify(quizDifficultyProgression));
  
  return progression;
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
            <button class="answer-option" data-answer="${option}" data-index="${index}" style="background: var(--bg-secondary); border: 2px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; text-align: left; color: white; transition: all 0.3s ease; cursor: pointer;">
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
        <button class="btn" onclick="${currentQuestionIndex === currentQuiz.questions.length - 1 ? 'finishQuiz()' : 'nextQuestion()'}" id="nextQuestionBtn" disabled style="flex: 1;">
          ${currentQuestionIndex === currentQuiz.questions.length - 1 ? '<i class="fas fa-check"></i> Finish Quiz' : 'Next <i class="fas fa-arrow-right"></i>'} 
        </button>
      </div>
    `;
    
    // Add event listeners to answer options
    const answerOptions = container.querySelectorAll('.answer-option');
    answerOptions.forEach(button => {
      button.addEventListener('click', function() {
        const answer = this.getAttribute('data-answer');
        selectAnswer(answer, this);
      });
    });
    
    // Restore previous selection if exists
    if (currentQuiz.userAnswers && currentQuiz.userAnswers[currentQuestionIndex]) {
      const previousAnswer = currentQuiz.userAnswers[currentQuestionIndex];
      const selectedButton = container.querySelector(`[data-answer="${previousAnswer}"]`);
      if (selectedButton) {
        selectedButton.classList.add('selected');
        selectedButton.style.background = 'rgba(99, 102, 241, 0.2)';
        selectedButton.style.borderColor = '#6366f1';
        
        // Enable next button if answer is selected
        const nextBtn = document.getElementById('nextQuestionBtn');
        if (nextBtn) nextBtn.disabled = false;
      }
    }
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
  console.log('nextQuestion called:', { currentQuestionIndex, totalQuestions: currentQuiz?.questions?.length });
  
  if (currentQuestionIndex < currentQuiz.questions.length - 1) {
    currentQuestionIndex++;
    displayQuestion();
  } else {
    console.log('Finishing quiz...');
    finishQuiz();
  }
}

function previousQuestion() {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    displayQuestion();
  }
}

async function finishQuiz() {
  console.log('🎯 finishQuiz called!', { currentQuiz, userAnswers: currentQuiz?.userAnswers });
  
  if (!currentQuiz) {
    console.error('No current quiz found!');
    showNotification('error', 'Quiz Error', 'No active quiz found');
    return;
  }
  
  try {
    // Handle backend quiz submission if it's a backend quiz
    if (currentQuiz.isBackendQuiz && currentQuiz.backendQuizId && authToken) {
      const response = await fetch(`/api/quiz/${currentQuiz.backendQuizId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          answers: currentQuiz.userAnswers
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Use backend results
        const results = data.result.questions.map(q => ({
          question: q.question,
          userAnswer: q.userAnswer,
          correctAnswer: q.correctAnswer,
          isCorrect: q.isCorrect,
          explanation: q.explanation
        }));
        
        displayQuizResults({
          score: data.result.score,
          correctAnswers: data.result.correctAnswers,
          totalQuestions: data.result.totalQuestions,
          results: results,
          xpEarned: data.result.xpEarned,
          streakBonus: 1
        });
        
        // Update local progression
        const accuracy = data.result.score;
        const progression = updateDifficultyProgression(currentQuiz.subject, accuracy);
        
        // Save to local history
        saveQuizResult(currentQuiz.subject, data.result.score, data.result.correctAnswers, data.result.totalQuestions);
        
        // Track for analytics
        trackQuizResult(currentQuiz.subject, data.result.correctAnswers, data.result.totalQuestions);
        
        showNotification('success', 'Quiz Completed!', `Score: ${data.result.score}% | +${data.result.xpEarned} XP earned!`);
        return;
      }
    }
  } catch (error) {
    console.error('Backend quiz submission error:', error);
    showNotification('warning', 'Offline Mode', 'Calculating results locally...');
  }
  
  // Fallback to frontend calculation
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
  
  // Track quiz result for study analytics
  trackQuizResult(currentQuiz.subject, correctAnswers, currentQuiz.questions.length);
  
  // Update difficulty progression
  const progression = updateDifficultyProgression(currentQuiz.subject, score);
  
  // Show progression message if level increased
  if (progression.level > (progression.previousLevel || 1)) {
    setTimeout(() => {
      showNotification(`🎉 Level Up! You've advanced to Level ${progression.level} in ${currentQuiz.subject}!`, 'success');
    }, 2000);
  }
  
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
          <p style="color: rgba(255,255,255,0.8); margin-bottom: 8px;">
            ${results.correctAnswers} out of ${results.totalQuestions} correct
          </p>
          <p style="color: rgba(255,255,255,0.6); margin-bottom: 16px; font-size: 14px;">
            Difficulty: ${getDifficultyName(currentQuiz.subject)} | Subject: ${currentQuiz.subject.charAt(0).toUpperCase() + currentQuiz.subject.slice(1)}
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
  
  // Track study session for analytics
  if (duration > 0) {
    trackStudySession(duration * 60, studySession.subject); // Convert minutes to seconds
  }
  
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
  // PWA support check logic would go here
}

// === ERROR HANDLING ===
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
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
  console.log('🎓 ChaseJEE AI Enhanced - Complete Learning Platform Loaded!');
  console.log('✨ Features: Authentication, AI Chat, Adaptive Quizzes, Study Timer, Progress Analytics, Achievement System, PWA Support');

// Disable Service Worker completely to fix CDN loading issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister().then(() => {
        console.log('🔧 Service Worker unregistered to fix CDN loading');
        // Force reload to clear Service Worker cache
        if (registrations.length > 0) {
          window.location.reload();
        }
      });
    }
  });
}

// Previous Year Questions & Books Management
async function searchQuestions() {
  try {
    const params = new URLSearchParams({
      subject: document.getElementById('questionSubjectFilter').value,
      year: document.getElementById('questionYearFilter').value,
      grade: document.getElementById('questionGradeFilter').value,
      search: document.getElementById('questionSearchInput').value,
      page: 1, limit: 12
    });
    
    const response = await fetch(`/api/questions/previous-year?${params}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    
    const data = await response.json();
    displayQuestions(data.questions);
    showNotification('✅ Questions loaded!', 'success');
  } catch (error) {
    showNotification('❌ Failed to load questions', 'error');
  }
}

function displayQuestions(questions) {
  const grid = document.getElementById('questionsGrid');
  grid.innerHTML = questions.map(q => `
    <div class="question-card" style="background: var(--card-bg); border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid var(--border-color); cursor: pointer; transition: all 0.3s ease;">
      <h4 style="color: var(--text-primary); margin-bottom: 8px;">${q.title}</h4>
      <div class="question-meta" style="display: flex; gap: 12px; margin-bottom: 12px;">
        <span style="background: var(--primary-color); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${q.subject}</span>
        <span style="color: var(--text-secondary);">${q.year}</span>
        <span style="color: var(--text-secondary);">${q.examName}</span>
      </div>
      <div class="question-stats" style="display: flex; gap: 16px; color: var(--text-secondary); font-size: 14px;">
        <span>⭐ ${q.rating.average.toFixed(1)}</span>
        <span>📥 ${q.downloadCount}</span>
        <span>⏱ ${q.duration || 'N/A'} min</span>
      </div>
    </div>
  `).join('');
}

async function searchBooks() {
  try {
    const params = new URLSearchParams({
      subject: document.getElementById('bookSubjectFilter').value,
      grade: document.getElementById('bookGradeFilter').value,
      bookType: document.getElementById('bookTypeFilter').value,
      sortBy: document.getElementById('bookSortFilter').value,
      search: document.getElementById('bookSearchInput').value,
      page: 1, limit: 12
    });
    
    const response = await fetch(`/api/books?${params}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    
    const data = await response.json();
    displayBooks(data.books);
    showNotification('✅ Books loaded!', 'success');
  } catch (error) {
    showNotification('❌ Failed to load books', 'error');
  }
}

function displayBooks(books) {
  const grid = document.getElementById('booksGrid');
  grid.innerHTML = books.map(book => `
    <div class="book-card" style="background: var(--card-bg); border-radius: 12px; padding: 20px; border: 1px solid var(--border-color); cursor: pointer; transition: all 0.3s ease;">
      <div class="book-cover" style="height: 120px; background: var(--secondary-gradient); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 12px; color: white; font-size: 24px;">
        ${book.coverImageUrl ? `<img src="${book.coverImageUrl}" alt="${book.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">` : '<i class="fas fa-book"></i>'}
      </div>
      <h4 style="color: var(--text-primary); margin-bottom: 4px; font-size: 16px;">${book.title}</h4>
      <p style="color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">by ${book.author}</p>
      <div class="book-meta" style="display: flex; gap: 8px; margin-bottom: 8px;">
        <span style="background: var(--primary-color); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${book.subject}</span>
        <span style="background: var(--secondary-color); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Grade ${book.grade}</span>
      </div>
      <div class="book-stats" style="display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 12px;">
        <span>⭐ ${book.rating.average.toFixed(1)}</span>
        <span>👁 ${book.viewCount}</span>
        <span style="text-transform: capitalize;">${book.bookType}</span>
      </div>
    </div>
  `).join('');
}

function addNewQuestion() {
  showNotification('📝 Question paper form feature coming soon!', 'info');
}

function addNewBook() {
  showNotification('📚 Add book form feature coming soon!', 'info');
}

// Dropdown menu toggle function
function toggleMenu() {
  const dropdown = document.getElementById('menuDropdown');
  dropdown.classList.toggle('show');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('menuDropdown');
  const menuToggle = document.querySelector('.menu-toggle');
  
  if (dropdown && !menuToggle.contains(event.target) && !dropdown.contains(event.target)) {
    dropdown.classList.remove('show');
  }
});

console.log('🎯 ChaseJEE - Enhanced JEE Preparation Platform initialized successfully!');
console.log('🎤 To test speech-to-text: Click the microphone button or press Ctrl+Shift+V');
console.log('🔧 Troubleshooting: Run debugSpeechRecognition() or testSpeechRecognition() in console');
console.log('📋 Requirements: Chrome/Edge/Safari, HTTPS/localhost, microphone permission');

// Relaxation Game Variables
let gameBoard = [];
let gameScore = 0;
let gameBest = parseInt(localStorage.getItem('chasejee-game-best')) || 0;
let gameTimer = 0;
let gameInterval = null;
let gameStartTime = null;
let gameActive = false;
let cooldownEndTime = parseInt(localStorage.getItem('chasejee-cooldown-end')) || 0;
let cooldownInterval = null;

// Game Constants
const GAME_TIME_LIMIT = 10 * 60; // 10 minutes in seconds
const COOLDOWN_TIME = 45 * 60; // 45 minutes in seconds

// Initialize game board
function initializeGameBoard() {
  gameBoard = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  gameScore = 0;
  updateGameDisplay();
  addRandomTile();
  addRandomTile();
  renderGameBoard();
}

// Add random tile (2 or 4)
function addRandomTile() {
  const emptyCells = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (gameBoard[i][j] === 0) {
        emptyCells.push({row: i, col: j});
      }
    }
  }
  
  if (emptyCells.length > 0) {
    const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    gameBoard[randomCell.row][randomCell.col] = Math.random() < 0.9 ? 2 : 4;
  }
}

// Render game board
function renderGameBoard() {
  const boardElement = document.getElementById('gameBoard');
  if (!boardElement) return;
  
  boardElement.innerHTML = '';
  
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const tile = document.createElement('div');
      tile.className = 'game-tile';
      
      if (gameBoard[i][j] !== 0) {
        tile.textContent = gameBoard[i][j];
        tile.classList.add(`tile-${gameBoard[i][j]}`);
      }
      
      boardElement.appendChild(tile);
    }
  }
}

// Update game display
function updateGameDisplay() {
  const scoreElement = document.getElementById('gameScore');
  const bestElement = document.getElementById('gameBest');
  const timerElement = document.getElementById('gameTimer');
  
  if (scoreElement) scoreElement.textContent = gameScore;
  if (bestElement) bestElement.textContent = gameBest;
  if (timerElement) {
    const minutes = Math.floor(gameTimer / 60);
    const seconds = gameTimer % 60;
    timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

// Start relaxation game
function startRelaxationGame() {
  // Check cooldown
  const now = Date.now();
  if (now < cooldownEndTime) {
    showCooldownNotice();
    return;
  }
  
  gameActive = true;
  gameTimer = 0;
  gameStartTime = now;
  
  // Initialize game
  initializeGameBoard();
  
  // Show game board
  document.getElementById('gameBoardContainer').style.display = 'block';
  document.getElementById('startGameBtn').style.display = 'none';
  document.getElementById('restartGameBtn').style.display = 'inline-flex';
  document.getElementById('stopGameBtn').style.display = 'inline-flex';
  
  // Start timer
  gameInterval = setInterval(() => {
    gameTimer++;
    updateGameDisplay();
    
    // Check time limit
    if (gameTimer >= GAME_TIME_LIMIT) {
      endGame('Time\'s up! 🕐 Take a study break and get back to your JEE preparation.');
    }
  }, 1000);
  
  // Add keyboard listeners
  document.addEventListener('keydown', handleGameKeyPress);
  
  showNotification('🎮 Game started! You have 10 minutes to play.', 'info');
  console.log('🎮 Relaxation game started');
}

// Stop game
function stopGame() {
  endGame('Game stopped. Time to focus on your studies! 📚');
}

// Restart game
function restartGame() {
  if (!gameActive) return;
  
  gameScore = 0;
  initializeGameBoard();
  showNotification('🔄 Game restarted!', 'info');
}

// End game
function endGame(message) {
  gameActive = false;
  
  // Clear timer
  if (gameInterval) {
    clearInterval(gameInterval);
    gameInterval = null;
  }
  
  // Remove keyboard listeners
  document.removeEventListener('keydown', handleGameKeyPress);
  
  // Update best score
  if (gameScore > gameBest) {
    gameBest = gameScore;
    localStorage.setItem('chasejee-game-best', gameBest.toString());
    updateGameDisplay();
    showNotification('🏆 New best score!', 'achievement');
  }
  
  // Set cooldown
  cooldownEndTime = Date.now() + (COOLDOWN_TIME * 1000);
  localStorage.setItem('chasejee-cooldown-end', cooldownEndTime.toString());
  
  // Show game message
  showGameMessage('Study Break Complete! 📚', message);
  
  // Hide game controls
  document.getElementById('gameBoardContainer').style.display = 'none';
  document.getElementById('startGameBtn').style.display = 'inline-flex';
  document.getElementById('restartGameBtn').style.display = 'none';
  document.getElementById('stopGameBtn').style.display = 'none';
  
  // Start cooldown timer
  startCooldownTimer();
  
  console.log('🎮 Relaxation game ended');
}

// Handle keyboard input
function handleGameKeyPress(event) {
  if (!gameActive) return;
  
  let moved = false;
  const previousBoard = gameBoard.map(row => [...row]);
  
  switch(event.key) {
    case 'ArrowUp':
      event.preventDefault();
      moved = moveUp();
      break;
    case 'ArrowDown':
      event.preventDefault();
      moved = moveDown();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      moved = moveLeft();
      break;
    case 'ArrowRight':
      event.preventDefault();
      moved = moveRight();
      break;
  }
  
  if (moved) {
    addRandomTile();
    renderGameBoard();
    updateGameDisplay();
    
    // Check for game over
    if (isGameOver()) {
      endGame('No more moves available! 🎯 Great job relaxing!');
    }
    
    // Check for 2048
    if (hasWon()) {
      showNotification('🎉 You reached 2048! Amazing!', 'achievement');
    }
  }
}

// Game movement functions
function moveLeft() {
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const row = gameBoard[i].filter(val => val !== 0);
    for (let j = 0; j < row.length - 1; j++) {
      if (row[j] === row[j + 1]) {
        row[j] *= 2;
        gameScore += row[j];
        row.splice(j + 1, 1);
      }
    }
    while (row.length < 4) {
      row.push(0);
    }
    
    for (let j = 0; j < 4; j++) {
      if (gameBoard[i][j] !== row[j]) {
        moved = true;
      }
      gameBoard[i][j] = row[j];
    }
  }
  return moved;
}

function moveRight() {
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const row = gameBoard[i].filter(val => val !== 0);
    for (let j = row.length - 1; j > 0; j--) {
      if (row[j] === row[j - 1]) {
        row[j] *= 2;
        gameScore += row[j];
        row.splice(j - 1, 1);
        j--;
      }
    }
    while (row.length < 4) {
      row.unshift(0);
    }
    
    for (let j = 0; j < 4; j++) {
      if (gameBoard[i][j] !== row[j]) {
        moved = true;
      }
      gameBoard[i][j] = row[j];
    }
  }
  return moved;
}

function moveUp() {
  let moved = false;
  for (let j = 0; j < 4; j++) {
    const column = [];
    for (let i = 0; i < 4; i++) {
      if (gameBoard[i][j] !== 0) {
        column.push(gameBoard[i][j]);
      }
    }
    
    for (let i = 0; i < column.length - 1; i++) {
      if (column[i] === column[i + 1]) {
        column[i] *= 2;
        gameScore += column[i];
        column.splice(i + 1, 1);
      }
    }
    
    while (column.length < 4) {
      column.push(0);
    }
    
    for (let i = 0; i < 4; i++) {
      if (gameBoard[i][j] !== column[i]) {
        moved = true;
      }
      gameBoard[i][j] = column[i];
    }
  }
  return moved;
}

function moveDown() {
  let moved = false;
  for (let j = 0; j < 4; j++) {
    const column = [];
    for (let i = 0; i < 4; i++) {
      if (gameBoard[i][j] !== 0) {
        column.push(gameBoard[i][j]);
      }
    }
    
    for (let i = column.length - 1; i > 0; i--) {
      if (column[i] === column[i - 1]) {
        column[i] *= 2;
        gameScore += column[i];
        column.splice(i - 1, 1);
        i--;
      }
    }
    
    while (column.length < 4) {
      column.unshift(0);
    }
    
    for (let i = 0; i < 4; i++) {
      if (gameBoard[i][j] !== column[i]) {
        moved = true;
      }
      gameBoard[i][j] = column[i];
    }
  }
  return moved;
}

// Check if game is over
function isGameOver() {
  // Check for empty cells
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (gameBoard[i][j] === 0) return false;
    }
  }
  
  // Check for possible merges
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      if (gameBoard[i][j] === gameBoard[i][j + 1]) return false;
      if (gameBoard[j][i] === gameBoard[j + 1][i]) return false;
    }
  }
  
  return true;
}

// Check if player has won
function hasWon() {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (gameBoard[i][j] === 2048) return true;
    }
  }
  return false;
}

// Show game message
function showGameMessage(title, text) {
  const messageElement = document.getElementById('gameMessage');
  const titleElement = document.getElementById('messageTitle');
  const textElement = document.getElementById('messageText');
  
  if (messageElement && titleElement && textElement) {
    titleElement.textContent = title;
    textElement.textContent = text;
    messageElement.style.display = 'flex';
  }
}

// Close game message
function closeGameMessage() {
  const messageElement = document.getElementById('gameMessage');
  if (messageElement) {
    messageElement.style.display = 'none';
  }
}

// Show cooldown notice
function showCooldownNotice() {
  const cooldownElement = document.getElementById('cooldownNotice');
  if (cooldownElement) {
    cooldownElement.style.display = 'block';
    startCooldownTimer();
  }
}

// Start cooldown timer
function startCooldownTimer() {
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
  }
  
  cooldownInterval = setInterval(() => {
    const now = Date.now();
    const timeLeft = Math.max(0, Math.ceil((cooldownEndTime - now) / 1000));
    
    if (timeLeft <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      document.getElementById('cooldownNotice').style.display = 'none';
      showNotification('🎮 Game is now available! Take a study break when needed.', 'info');
      return;
    }
    
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timerElement = document.getElementById('cooldownTimer');
    if (timerElement) {
      timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

// Study Analytics Variables
let studyAnalytics = {
  totalStudyTime: parseInt(localStorage.getItem('chasejee-total-study-time')) || 0,
  dailyStudyTimes: JSON.parse(localStorage.getItem('chasejee-daily-study-times')) || [],
  quizResults: JSON.parse(localStorage.getItem('chasejee-quiz-results')) || [],
  subjectTime: JSON.parse(localStorage.getItem('chasejee-subject-time')) || {},
  studyStreak: parseInt(localStorage.getItem('chasejee-study-streak')) || 0,
  lastStudyDate: localStorage.getItem('chasejee-last-study-date') || null
};

// Initialize analytics
function initializeAnalytics() {
  updateAnalyticsDisplay();
  createAnalyticsCharts();
  updateSubjectPerformance();
  generateRecommendations();
}

// Update analytics display
function updateAnalyticsDisplay() {
  // Total study time
  const hours = Math.floor(studyAnalytics.totalStudyTime / 3600);
  const minutes = Math.floor((studyAnalytics.totalStudyTime % 3600) / 60);
  document.getElementById('totalStudyTimeMetric').textContent = `${hours}h ${minutes}m`;
  
  // Quiz accuracy
  const accuracy = calculateOverallAccuracy();
  document.getElementById('quizAccuracyMetric').textContent = `${accuracy}%`;
  
  // Study streak
  document.getElementById('studyStreakMetric').textContent = `${studyAnalytics.studyStreak} days`;
  
  // Weekly progress
  const weeklyProgress = calculateWeeklyProgress();
  document.getElementById('weeklyProgressMetric').textContent = `${weeklyProgress}%`;
}

// Calculate overall quiz accuracy
function calculateOverallAccuracy() {
  if (studyAnalytics.quizResults.length === 0) return 0;
  const totalCorrect = studyAnalytics.quizResults.reduce((sum, result) => sum + result.correct, 0);
  const totalQuestions = studyAnalytics.quizResults.reduce((sum, result) => sum + result.total, 0);
  return totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
}

// Calculate weekly progress
function calculateWeeklyProgress() {
  const weeklyGoal = 20 * 3600; // 20 hours per week
  const weeklyTime = getWeeklyStudyTime();
  return Math.min(100, Math.round((weeklyTime / weeklyGoal) * 100));
}

// Get weekly study time
function getWeeklyStudyTime() {
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  return studyAnalytics.dailyStudyTimes
    .filter(entry => entry.date > oneWeekAgo)
    .reduce((sum, entry) => sum + entry.time, 0);
}

// Create analytics charts
function createAnalyticsCharts() {
  createDailyStudyChart();
  createSubjectDistributionChart();
  createWeeklyAnalyticsChart();
}

// Create daily study chart
function createDailyStudyChart() {
  const canvas = document.getElementById('dailyStudyChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const last7Days = getLast7DaysData();
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: last7Days.labels,
      datasets: [{
        label: 'Study Hours',
        data: last7Days.data,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } },
        x: { grid: { color: 'rgba(255,255,255,0.1)' } }
      }
    }
  });
}

// Get last 7 days data
function getLast7DaysData() {
  const labels = [];
  const data = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toDateString();
    labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
    
    const dayData = studyAnalytics.dailyStudyTimes.find(entry => 
      new Date(entry.date).toDateString() === dateStr
    );
    data.push(dayData ? Math.round(dayData.time / 3600 * 10) / 10 : 0);
  }
  
  return { labels, data };
}

// Update subject performance
function updateSubjectPerformance() {
  const subjects = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science'];
  const subjectKeys = ['mathematics', 'physics', 'chemistry', 'biology', 'computer_science'];
  
  subjects.forEach((subject, index) => {
    const key = subjectKeys[index];
    const accuracy = getSubjectAccuracy(key);
    const performanceBar = document.querySelector(`.subject-item:nth-child(${index + 1}) .performance-fill`);
    const performanceScore = document.querySelector(`.subject-item:nth-child(${index + 1}) .performance-score`);
    
    if (performanceBar && performanceScore) {
      performanceBar.style.width = `${accuracy}%`;
      performanceScore.textContent = `${accuracy}%`;
    }
  });
}

// Get subject accuracy
function getSubjectAccuracy(subject) {
  const subjectResults = studyAnalytics.quizResults.filter(result => result.subject === subject);
  if (subjectResults.length === 0) return 0;
  
  const totalCorrect = subjectResults.reduce((sum, result) => sum + result.correct, 0);
  const totalQuestions = subjectResults.reduce((sum, result) => sum + result.total, 0);
  return totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
}

// Track study session
function trackStudySession(duration, subject = 'general') {
  studyAnalytics.totalStudyTime += duration;
  
  const today = new Date().toDateString();
  const todayEntry = studyAnalytics.dailyStudyTimes.find(entry => 
    new Date(entry.date).toDateString() === today
  );
  
  if (todayEntry) {
    todayEntry.time += duration;
  } else {
    studyAnalytics.dailyStudyTimes.push({ date: Date.now(), time: duration });
  }
  
  // Update subject time
  if (!studyAnalytics.subjectTime[subject]) {
    studyAnalytics.subjectTime[subject] = 0;
  }
  studyAnalytics.subjectTime[subject] += duration;
  
  // Update streak
  updateStudyStreak();
  
  // Save to localStorage
  saveAnalyticsData();
  updateAnalyticsDisplay();
}

// Track quiz result
function trackQuizResult(subject, correct, total) {
  const difficultyLevel = getDifficultyLevel(subject);
  const difficulty = getAdaptiveDifficulty(subject);
  
  studyAnalytics.quizResults.push({
    subject,
    correct,
    total,
    date: Date.now(),
    accuracy: Math.round((correct / total) * 100),
    difficulty: difficulty,
    difficultyLevel: difficultyLevel
  });
  
  // Keep only last 100 results
  if (studyAnalytics.quizResults.length > 100) {
    studyAnalytics.quizResults = studyAnalytics.quizResults.slice(-100);
  }
  
  saveAnalyticsData();
  updateAnalyticsDisplay();
  updateSubjectPerformance();
}

// Save analytics data
function saveAnalyticsData() {
  localStorage.setItem('chasejee-total-study-time', studyAnalytics.totalStudyTime.toString());
  localStorage.setItem('chasejee-daily-study-times', JSON.stringify(studyAnalytics.dailyStudyTimes));
  localStorage.setItem('chasejee-quiz-results', JSON.stringify(studyAnalytics.quizResults));
  localStorage.setItem('chasejee-subject-time', JSON.stringify(studyAnalytics.subjectTime));
  localStorage.setItem('chasejee-study-streak', studyAnalytics.studyStreak.toString());
  localStorage.setItem('chasejee-last-study-date', studyAnalytics.lastStudyDate);
}

// Update study streak
function updateStudyStreak() {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  
  if (studyAnalytics.lastStudyDate === today) {
    // Already studied today, no change
    return;
  } else if (studyAnalytics.lastStudyDate === yesterday) {
    // Studied yesterday, increment streak
    studyAnalytics.studyStreak++;
  } else if (studyAnalytics.lastStudyDate !== null) {
    // Missed a day, reset streak
    studyAnalytics.studyStreak = 1;
  } else {
    // First time studying
    studyAnalytics.studyStreak = 1;
  }
  
  studyAnalytics.lastStudyDate = today;
}

// Create subject distribution chart
function createSubjectDistributionChart() {
  const canvas = document.getElementById('subjectDistributionChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const subjectData = getSubjectDistributionData();
  
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: subjectData.labels,
      datasets: [{
        data: subjectData.data,
        backgroundColor: [
          '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: 'white' } }
      }
    }
  });
}

// Get subject distribution data
function getSubjectDistributionData() {
  const subjects = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science'];
  const subjectKeys = ['mathematics', 'physics', 'chemistry', 'biology', 'computer_science'];
  
  const data = subjectKeys.map(key => studyAnalytics.subjectTime[key] || 0);
  const total = data.reduce((sum, time) => sum + time, 0);
  
  if (total === 0) {
    return { labels: ['No data'], data: [1] };
  }
  
  return { labels: subjects, data };
}

// Create weekly analytics chart
function createWeeklyAnalyticsChart() {
  const canvas = document.getElementById('weeklyAnalyticsChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const weeklyData = getWeeklyAnalyticsData();
  
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeklyData.labels,
      datasets: [{
        label: 'Study Time (hours)',
        data: weeklyData.studyTime,
        backgroundColor: 'rgba(99, 102, 241, 0.8)'
      }, {
        label: 'Quiz Accuracy (%)',
        data: weeklyData.accuracy,
        backgroundColor: 'rgba(139, 92, 246, 0.8)',
        yAxisID: 'y1'
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, position: 'left' },
        y1: { type: 'linear', display: true, position: 'right', max: 100 }
      }
    }
  });
}

// Get weekly analytics data
function getWeeklyAnalyticsData() {
  const labels = [];
  const studyTime = [];
  const accuracy = [];
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toDateString();
    
    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    
    // Study time for this day
    const dayStudy = studyAnalytics.dailyStudyTimes.find(entry => 
      new Date(entry.date).toDateString() === dateStr
    );
    studyTime.push(dayStudy ? Math.round(dayStudy.time / 3600 * 10) / 10 : 0);
    
    // Quiz accuracy for this day
    const dayQuizzes = studyAnalytics.quizResults.filter(result => 
      new Date(result.date).toDateString() === dateStr
    );
    
    if (dayQuizzes.length > 0) {
      const dayAccuracy = dayQuizzes.reduce((sum, quiz) => sum + quiz.accuracy, 0) / dayQuizzes.length;
      accuracy.push(Math.round(dayAccuracy));
    } else {
      accuracy.push(0);
    }
  }
  
  return { labels, studyTime, accuracy };
}

// Generate AI recommendations
function generateRecommendations() {
  // This would typically call an AI service, but for now we'll use rule-based recommendations
  const recommendations = [];
  
  // Check subject performance
  const subjects = ['mathematics', 'physics', 'chemistry', 'biology', 'computer_science'];
  const subjectNames = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science'];
  
  subjects.forEach((subject, index) => {
    const accuracy = getSubjectAccuracy(subject);
    if (accuracy < 70 && accuracy > 0) {
      recommendations.push({
        priority: 'high',
        title: `Focus on ${subjectNames[index]}`,
        message: `Your ${subjectNames[index].toLowerCase()} accuracy (${accuracy}%) needs improvement. Consider additional practice.`,
        action: `Start ${subjectNames[index]} Session`
      });
    }
  });
  
  // Check study consistency
  const weeklyTime = getWeeklyStudyTime();
  if (weeklyTime < 10 * 3600) { // Less than 10 hours per week
    recommendations.push({
      priority: 'medium',
      title: 'Increase Study Time',
      message: 'You\'re studying less than 10 hours per week. Consider increasing your daily study time.',
      action: 'Set Study Schedule'
    });
  }
  
  // Check streak
  if (studyAnalytics.studyStreak >= 7) {
    recommendations.push({
      priority: 'low',
      title: 'Great Consistency!',
      message: `Amazing ${studyAnalytics.studyStreak}-day study streak! Keep up the excellent work.`,
      action: 'Continue Streak'
    });
  }
  
  return recommendations;
}

// Export analytics
function exportAnalytics() {
  const data = {
    totalStudyTime: studyAnalytics.totalStudyTime,
    studyStreak: studyAnalytics.studyStreak,
    overallAccuracy: calculateOverallAccuracy(),
    weeklyProgress: calculateWeeklyProgress(),
    subjectPerformance: {},
    exportDate: new Date().toISOString()
  };
  
  // Add subject performance
  const subjects = ['mathematics', 'physics', 'chemistry', 'biology', 'computer_science'];
  subjects.forEach(subject => {
    data.subjectPerformance[subject] = getSubjectAccuracy(subject);
  });
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chasejee-analytics-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showNotification('📊 Analytics exported successfully!', 'success');
}

// Reset analytics
function resetAnalytics() {
  if (confirm('Are you sure you want to reset all analytics data? This cannot be undone.')) {
    localStorage.removeItem('chasejee-total-study-time');
    localStorage.removeItem('chasejee-daily-study-times');
    localStorage.removeItem('chasejee-quiz-results');
    localStorage.removeItem('chasejee-subject-time');
    localStorage.removeItem('chasejee-study-streak');
    localStorage.removeItem('chasejee-last-study-date');
    
    // Reset variables
    studyAnalytics = {
      totalStudyTime: 0,
      dailyStudyTimes: [],
      quizResults: [],
      subjectTime: {},
      studyStreak: 0,
      lastStudyDate: null
    };
    
    updateAnalyticsDisplay();
    updateSubjectPerformance();
    showNotification('🔄 Analytics data reset successfully!', 'info');
  }
}

// Set study goals
function setStudyGoals() {
  showNotification('🎯 Study goals feature coming soon!', 'info');
}

// Analytics recommendation actions
function focusOnSubject(subject) {
  showSection('ai-chat');
  const input = document.getElementById('userInput');
  if (input) {
    input.value = `Help me improve my ${subject} skills. What topics should I focus on?`;
    sendMessage();
  }
}

function getPhysicsResources() {
  showSection('books-database');
  showNotification('📚 Check the Books Database for physics resources!', 'info');
}

function optimizeSchedule() {
  showNotification('📅 Schedule optimization feature coming soon!', 'info');
}

function continueChemistry() {
  showSection('quizzes');
  const subjectSelect = document.getElementById('quizSubject');
  if (subjectSelect) {
    subjectSelect.value = 'chemistry';
  }
}

// Analytics tab functions
function showAnalyticsTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  document.querySelector(`[onclick="showAnalyticsTab('${tab}')"]`).classList.add('active');
  document.getElementById(`${tab}Tab`).classList.add('active');
}

// Initialize game on page load
document.addEventListener('DOMContentLoaded', () => {
  // Check if cooldown is active
  const now = Date.now();
  if (now < cooldownEndTime) {
    showCooldownNotice();
  }
  
  // Update best score display
  updateGameDisplay();
  
  // Initialize analytics
  initializeAnalytics();
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
window.testVoiceButton = testVoiceButton;
window.debugSpeechRecognition = debugSpeechRecognition;
window.testSpeechRecognition = testSpeechRecognition;
window.openFileUpload = openFileUpload;
window.handleFileUpload = handleFileUpload;
window.toggleTheme = toggleTheme;
window.startRelaxationGame = startRelaxationGame;
window.stopGame = stopGame;
window.restartGame = restartGame;
window.closeGameMessage = closeGameMessage;
window.generateQuiz = generateQuiz;
window.selectAnswer = selectAnswer;
window.nextQuestion = nextQuestion;
window.previousQuestion = previousQuestion;
window.finishQuiz = finishQuiz;
window.showAnalyticsTab = showAnalyticsTab;
window.exportAnalytics = exportAnalytics;
window.resetAnalytics = resetAnalytics;
window.setStudyGoals = setStudyGoals;
window.focusOnSubject = focusOnSubject;
window.getPhysicsResources = getPhysicsResources;
window.optimizeSchedule = optimizeSchedule;
window.continueChemistry = continueChemistry;
window.setTimerPreset = setTimerPreset;
window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resetTimer = resetTimer;
window.showSection = showSection;
window.exportUserData = exportUserData;
window.searchQuestions = searchQuestions;
window.searchBooks = searchBooks;
window.addNewQuestion = addNewQuestion;
window.addNewBook = addNewBook;
window.toggleMenu = toggleMenu;
window.showHelp = showHelp;


console.log('🚀 ChaseJEE AI Enhanced - Complete version initialized successfully!');
});