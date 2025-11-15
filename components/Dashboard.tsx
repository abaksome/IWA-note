import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration, LiveSession, LiveServerMessage, Modality, Blob } from "@google/genai";
import { Note, Todo, CalendarEvent, VoiceNote, ActiveView, Priority, Attendee } from '../types';
import { NoteIcon, MicIcon, TodoIcon, CalendarIcon, SaveIcon, SpinnerIcon, LogoutIcon, TrashIcon, StopIcon, PlusIcon, BellIcon, SettingsIcon, SearchIcon, DownloadIcon, UserIcon } from './icons';
import { useTheme, themes } from './Theme';

// --- Typescript declarations for external libraries ---
declare global {
  interface Window {
    jspdf: any;
  }
}

// --- Gemini Live API Audio Helper Functions ---
function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}


const Dashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
    const { theme, setTheme } = useTheme();
    const { colors } = theme;

    const [user, setUser] = useState<{ name: string; email: string } | null>(null);
    const [activeView, setActiveView] = useState<ActiveView>('notes');
    
    // Data states
    const [notes, setNotes] = useState<Note[]>([]);
    const [currentNote, setCurrentNote] = useState('');
    const [todos, setTodos] = useState<Todo[]>([]);
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);

    // Note states
    const [noteSummary, setNoteSummary] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [noteSearchQuery, setNoteSearchQuery] = useState('');
    const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);

    // To-Do states
    const [newTodo, setNewTodo] = useState('');
    const [newTodoReminder, setNewTodoReminder] = useState('');
    const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
    const [editingTodoText, setEditingTodoText] = useState('');
    const [newTodoPriority, setNewTodoPriority] = useState<Priority>('Medium');
    const [todoSortOrder, setTodoSortOrder] = useState<'default' | 'priority'>('default');

    // Calendar states
    const [eventInput, setEventInput] = useState('');
    const [eventReminderMinutes, setEventReminderMinutes] = useState<number | null>(15);
    const [isScheduling, setIsScheduling] = useState(false);
    const [newEventAttendees, setNewEventAttendees] = useState<Attendee[]>([]);
    const [currentAttendee, setCurrentAttendee] = useState<Attendee>({ name: '', email: '', phone: '' });

    // Voice note recording states
    const [isRecording, setIsRecording] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [transcription, setTranscription] = useState('');
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const recordingTimerRef = useRef<number | null>(null);

    // Notification state
    const [notificationPermission, setNotificationPermission] = useState(Notification.permission);
    
    // Load data from localStorage on mount
    useEffect(() => {
        try {
            const storedUser = localStorage.getItem('user');
            if(storedUser) setUser(JSON.parse(storedUser));
            
            const storedNotes = localStorage.getItem('iwa-notes');
            if(storedNotes) setNotes(JSON.parse(storedNotes).map((n: any) => ({...n, createdAt: new Date(n.createdAt)})));

            const storedTodos = localStorage.getItem('iwa-todos');
            if (storedTodos) {
                const parsedTodos = JSON.parse(storedTodos);
                // Add default priority for old todos that don't have one
                const migratedTodos = parsedTodos.map((todo: any) => ({
                    ...todo,
                    priority: todo.priority || 'Medium'
                }));
                setTodos(migratedTodos);
            }

            const storedEvents = localStorage.getItem('iwa-events');
            if(storedEvents) setCalendarEvents(JSON.parse(storedEvents));

            const storedVoiceNotes = localStorage.getItem('iwa-voicenotes');
            if(storedVoiceNotes) setVoiceNotes(JSON.parse(storedVoiceNotes).map((n: any) => ({...n, createdAt: new Date(n.createdAt)})));

        } catch (error) {
            console.error("Failed to parse data from localStorage", error);
        }
        
        // Request notification permission
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(setNotificationPermission);
        }
    }, []);
    
    // --- Auto-save data to localStorage whenever it changes ---
    useEffect(() => {
        try {
            localStorage.setItem('iwa-notes', JSON.stringify(notes));
        } catch (e) { console.error("Failed to save notes", e); }
    }, [notes]);

    useEffect(() => {
        try {
            localStorage.setItem('iwa-todos', JSON.stringify(todos));
        } catch (e) { console.error("Failed to save todos", e); }
    }, [todos]);

    useEffect(() => {
        try {
            localStorage.setItem('iwa-events', JSON.stringify(calendarEvents));
        } catch (e) { console.error("Failed to save calendar events", e); }
    }, [calendarEvents]);

    useEffect(() => {
        try {
            localStorage.setItem('iwa-voicenotes', JSON.stringify(voiceNotes));
        } catch (e) { console.error("Failed to save voice notes", e); }
    }, [voiceNotes]);


    // --- Reminder and Notification Logic ---
    useEffect(() => {
        if (notificationPermission !== 'granted') return;

        const checkReminders = () => {
            const now = new Date();

            // Check To-Do Reminders
            setTodos(prevTodos => {
                let needsUpdate = false;
                const newTodos = prevTodos.map(todo => {
                    if (todo.reminder && !todo.completed && !todo.notified && new Date(todo.reminder) <= now) {
                        new Notification('IWA Note Reminder', {
                            body: `Don't forget: ${todo.text}`,
                        });
                        needsUpdate = true;
                        return { ...todo, notified: true };
                    }
                    return todo;
                });
                return needsUpdate ? newTodos : prevTodos;
            });

            // Check Calendar Event Alarms
            setCalendarEvents(prevEvents => {
                let needsUpdate = false;
                const newEvents = prevEvents.map(event => {
                    if (event.reminder !== undefined && event.reminder !== null && !event.notified) {
                        try {
                            const eventDateTime = new Date(`${event.date}T${event.time}`);
                            const reminderTime = new Date(eventDateTime.getTime() - event.reminder * 60000);
                            if (reminderTime <= now) {
                                new Notification('IWA Note: Upcoming Event', {
                                    body: `${event.title} starts in ${event.reminder} minutes.`,
                                });
                                needsUpdate = true;
                                return { ...event, notified: true };
                            }
                        } catch (e) {
                            console.error("Error parsing event date for reminder", e);
                        }
                    }
                    return event;
                });
                return needsUpdate ? newEvents : prevEvents;
            });
        };

        const intervalId = setInterval(checkReminders, 30000); // Check every 30 seconds
        return () => clearInterval(intervalId);
    }, [notificationPermission, setTodos, setCalendarEvents]);
    
    // --- Notes Logic ---
    const handleSaveNote = () => {
        if (currentNote.trim()) {
            setShowSaveConfirmation(true);
        }
    };

    const confirmAndSaveNote = () => {
        if (currentNote.trim()) {
            const newNote: Note = { id: Date.now().toString(), content: currentNote.trim(), createdAt: new Date() };
            setNotes(prev => [newNote, ...prev]);
            setCurrentNote('');
            setNoteSummary('');
        }
        setShowSaveConfirmation(false);
    };

    const handleSummarizeNote = async () => {
        if (!currentNote.trim()) return;
        setIsSummarizing(true);
        setNoteSummary('');
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Please provide a concise summary of the following meeting notes:\n\n---\n\n${currentNote}`,
            });
            setNoteSummary(response.text);
        } catch (error) {
            console.error('Error summarizing note:', error);
            setNoteSummary('Sorry, I was unable to generate a summary. Please try again.');
        } finally {
            setIsSummarizing(false);
        }
    };

     const handleDeleteNote = (id: string) => {
        setNotes(notes.filter(note => note.id !== id));
    };

    const handleDownloadAsPDF = (content: string, title: string) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const margin = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const usableWidth = pageWidth - 2 * margin;
        
        doc.setFontSize(18);
        doc.text(title, margin, 20);
        
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(content, usableWidth);
        doc.text(lines, margin, 30);
        
        doc.save(`${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    };

    // --- To-Do Logic ---
    const handleAddTodo = () => {
        if (newTodo.trim()) {
            const newTodoItem: Todo = { 
                id: Date.now().toString(), 
                text: newTodo.trim(), 
                completed: false,
                priority: newTodoPriority,
                ...(newTodoReminder && { reminder: newTodoReminder, notified: false })
            };
            setTodos(prev => [...prev, newTodoItem]);
            setNewTodo('');
            setNewTodoReminder('');
            setNewTodoPriority('Medium');
        }
    };
    const toggleTodo = (id: string) => {
        setTodos(todos.map(todo => todo.id === id ? { ...todo, completed: !todo.completed } : todo));
    };
     const handleDeleteTodo = (id: string) => {
        setTodos(todos.filter(todo => todo.id !== id));
    };

    const handleStartEditTodo = (todo: Todo) => {
        setEditingTodoId(todo.id);
        setEditingTodoText(todo.text);
    };

    const handleCancelEditTodo = () => {
        setEditingTodoId(null);
        setEditingTodoText('');
    };

    const handleSaveEditTodo = (id: string) => {
        if (!editingTodoText.trim()) {
            handleDeleteTodo(id); // Delete if the text is cleared
        } else {
            setTodos(todos.map(todo =>
                todo.id === id ? { ...todo, text: editingTodoText.trim() } : todo
            ));
        }
        handleCancelEditTodo(); // Reset editing state
    };
    
    const sortedTodos = useMemo(() => {
        if (todoSortOrder === 'priority') {
            const priorityOrder: Record<Priority, number> = { 'High': 1, 'Medium': 2, 'Low': 3 };
            return [...todos].sort((a, b) => {
                if (a.completed !== b.completed) {
                    return a.completed ? 1 : -1; // Incomplete items first
                }
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });
        }
        return todos; // Default order (creation order)
    }, [todos, todoSortOrder]);


    // --- Calendar Logic (Gemini Function Calling) ---
    const handleAddAttendee = () => {
        if (currentAttendee.name && currentAttendee.email) {
            setNewEventAttendees([...newEventAttendees, currentAttendee]);
            setCurrentAttendee({ name: '', email: '', phone: '' });
        }
    };
    const handleRemoveAttendee = (index: number) => {
        setNewEventAttendees(newEventAttendees.filter((_, i) => i !== index));
    };

    const handleScheduleEvent = async () => {
        if (!eventInput.trim()) return;
        setIsScheduling(true);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const createEventFunctionDeclaration: FunctionDeclaration = {
                name: 'create_calendar_event',
                parameters: {
                    type: Type.OBJECT,
                    description: 'Creates a calendar event with details extracted from user input.',
                    properties: {
                        title: { type: Type.STRING, description: 'The title of the event.' },
                        date: { type: Type.STRING, description: 'The date of the event in YYYY-MM-DD format.' },
                        time: { type: Type.STRING, description: 'The time of the event in HH:MM format (24-hour clock).' },
                        attendees: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'List of attendee names.' },
                        description: { type: Type.STRING, description: 'A brief description of the event.' },
                    },
                    required: ['title', 'date', 'time'],
                },
            };
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Create a calendar event based on this: "${eventInput}"`,
                config: {
                    tools: [{ functionDeclarations: [createEventFunctionDeclaration] }],
                },
            });

            const functionCall = response.functionCalls?.[0];
            if (functionCall && functionCall.name === 'create_calendar_event') {
                const { title, date, time, attendees: extractedNames, description } = functionCall.args;
                
                // Combine AI extracted names with manually entered full attendee details
                const combinedAttendees: Attendee[] = [...newEventAttendees];
                if (extractedNames) {
                    extractedNames.forEach((name: string) => {
                        if (!combinedAttendees.some(a => a.name.toLowerCase() === name.toLowerCase())) {
                            combinedAttendees.push({ name, email: '', phone: '' });
                        }
                    });
                }
                
                const newEvent: CalendarEvent = { 
                    id: Date.now().toString(), 
                    title, 
                    date, 
                    time, 
                    attendees: combinedAttendees,
                    description,
                    ...(eventReminderMinutes !== null && { reminder: eventReminderMinutes, notified: false })
                };
                setCalendarEvents(prev => [newEvent, ...prev]);
                setEventInput('');
                setNewEventAttendees([]);
            } else {
                 alert("I couldn't understand the event details. Please try being more specific.");
            }
        } catch (error) {
            console.error('Error scheduling event:', error);
            alert('An error occurred while scheduling the event.');
        } finally {
            setIsScheduling(false);
        }
    };
    const handleDeleteEvent = (id: string) => {
        setCalendarEvents(calendarEvents.filter(event => event.id !== id));
    };
    
    const formatDuration = (totalSeconds: number) => {
        if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    // --- Voice Note Logic (Gemini Live API) ---
    const stopRecording = useCallback(async () => {
        setIsRecording(false);
        setIsConnecting(false);
        
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }

        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
            sessionPromiseRef.current = null;
        }
        
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        
        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;

        inputAudioContextRef.current?.close();
        inputAudioContextRef.current = null;

        if (transcription.trim()) {
            const newVoiceNote: VoiceNote = { id: Date.now().toString(), transcription, createdAt: new Date(), duration: recordingDuration };
            setVoiceNotes(prev => [newVoiceNote, ...prev]);
        }
        setTranscription('');
        setRecordingDuration(0);
    }, [transcription, recordingDuration]);

    const startRecording = useCallback(async () => {
        setTranscription('');
        setIsConnecting(true);
        setRecordingError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setIsConnecting(false);
                        setIsRecording(true);
                        
                        setRecordingDuration(0);
                        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
                        recordingTimerRef.current = window.setInterval(() => {
                            setRecordingDuration(prev => prev + 1);
                        }, 1000);

                        const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;

                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            setTranscription(prev => prev + text);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        setRecordingError('A connection error occurred. Please try again.');
                        stopRecording();
                    },
                    onclose: (e: CloseEvent) => {
                         console.log('Live session closed');
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                },
            });
        } catch (error: any) {
            console.error('Failed to start recording:', error);
            if (error.name === 'NotAllowedError') {
                 setRecordingError('Microphone permission denied. Please enable it in your browser settings to use this feature.');
            } else {
                 setRecordingError('Could not start recording. Please ensure your microphone is working and permissions are granted.');
            }
            setIsConnecting(false);
        }
    }, [stopRecording]);

    useEffect(() => {
        return () => {
            if (isRecording) {
                stopRecording();
            }
        };
    }, [isRecording, stopRecording]);

    const handleDeleteVoiceNote = (id: string) => {
        setVoiceNotes(voiceNotes.filter(note => note.id !== id));
    };

    const PriorityBadge: React.FC<{ priority: Priority }> = ({ priority }) => {
        const styleMap: Record<Priority, string> = {
            'High': 'bg-red-500/20 text-red-400',
            'Medium': 'bg-amber-500/20 text-amber-400',
            'Low': 'bg-sky-500/20 text-sky-400',
        };

        return (
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${styleMap[priority]}`}>
                {priority}
            </span>
        );
    };


    const renderContent = () => {
        switch (activeView) {
            case 'notes':
                return (
                    <div className="flex flex-col md:flex-row gap-6 h-full">
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className={`text-xl font-semibold mb-3 ${colors.textAccent}`}>New Note</h3>
                            <textarea
                                value={currentNote}
                                onChange={(e) => {
                                    setCurrentNote(e.target.value);
                                    if (noteSummary) setNoteSummary('');
                                }}
                                placeholder="Start typing your meeting notes..."
                                className={`w-full flex-grow p-4 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none resize-none`}
                            ></textarea>

                            {(isSummarizing || noteSummary) && (
                                <div className={`mt-4 p-4 ${colors.bgSecondary} border ${colors.border} rounded-lg`}>
                                    <h4 className={`text-md font-semibold ${colors.textAccent} mb-2`}>AI Summary</h4>
                                    {isSummarizing ? (
                                        <div className={`flex items-center ${colors.textSecondary}`}>
                                            <SpinnerIcon className="w-5 h-5 mr-2"/>
                                            <span>Generating summary...</span>
                                        </div>
                                    ) : (
                                        <p className={`${colors.textPrimary} whitespace-pre-wrap`}>{noteSummary}</p>
                                    )}
                                </div>
                            )}
                            
                            <div className="flex gap-4 mt-4">
                                <button
                                    onClick={handleSummarizeNote}
                                    disabled={isSummarizing || !currentNote.trim()}
                                    className={`flex-1 ${colors.secondaryAccent} ${colors.secondaryAccentHover} ${colors.accentText} font-bold py-2 px-4 rounded-lg transition-colors flex justify-center items-center ${colors.buttonDisabled}`}
                                >
                                    {isSummarizing ? <SpinnerIcon className="w-5 h-5 mr-2" /> : null}
                                    Summarize with AI
                                </button>
                                <button onClick={handleSaveNote} disabled={!currentNote.trim()} className={`flex-1 ${colors.accent} ${colors.accentHover} ${colors.accentText} font-bold py-2 px-4 rounded-lg transition-colors ${colors.buttonDisabled}`}>Save Note</button>
                            </div>
                        </div>
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className={`text-xl font-semibold mb-3 ${colors.textAccent}`}>Saved Notes</h3>
                            <div className="relative mb-4">
                                <span className={`absolute inset-y-0 left-0 flex items-center pl-3 ${colors.textSecondary}`}>
                                    <SearchIcon className="h-5 w-5" />
                                </span>
                                <input
                                    type="text"
                                    value={noteSearchQuery}
                                    onChange={(e) => setNoteSearchQuery(e.target.value)}
                                    placeholder="Search notes..."
                                    className={`w-full p-2 pl-10 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none`}
                                />
                            </div>
                            <div className="space-y-3 overflow-y-auto pr-2 flex-grow">
                                {notes
                                    .filter(note => note.content.toLowerCase().includes(noteSearchQuery.toLowerCase()))
                                    .map(note => (
                                    <div key={note.id} className={`${colors.bgSecondary} p-4 rounded-lg border ${colors.border} relative group`}>
                                        <p className={`${colors.textPrimary} whitespace-pre-wrap`}>{note.content}</p>
                                        <p className={`text-xs ${colors.textSecondary} mt-2`}>{note.createdAt.toLocaleString()}</p>
                                        <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleDownloadAsPDF(note.content, `Note_${note.id}`)} className={`p-1 ${colors.textSecondary} hover:text-sky-400`}>
                                                <DownloadIcon className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDeleteNote(note.id)} className={`p-1 ${colors.textSecondary} ${colors.dangerTextHover}`}>
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'voice':
                 return (
                    <div className="flex flex-col md:flex-row gap-6 h-full">
                        <div className={`md:w-1/2 flex flex-col items-center justify-center ${colors.bgSecondary} p-6 rounded-lg border ${colors.border}`}>
                             <h3 className={`text-xl font-semibold mb-4 ${colors.textAccent}`}>Voice Memo & Transcription</h3>
                             <button 
                                onClick={isRecording ? stopRecording : startRecording}
                                disabled={isConnecting}
                                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-4 ${
                                    isRecording ? 'bg-red-500 hover:bg-red-600 ring-red-400' : `${colors.accent} ${colors.accentHover} ${colors.accentFocusRing}`
                                }`}
                            >
                                {isConnecting ? <SpinnerIcon className="w-10 h-10 text-white" /> : isRecording ? <StopIcon className="w-10 h-10 text-white"/> : <MicIcon className="w-10 h-10 text-white"/>}
                            </button>
                             <p className={`mt-4 ${colors.textSecondary} h-6 text-center`}>
                                {isConnecting ? 'Connecting...' : isRecording ? `Recording... ${formatDuration(recordingDuration)}` : 'Tap to start recording'}
                             </p>
                            {recordingError && <p className={`mt-2 text-sm ${colors.dangerText} text-center`}>{recordingError}</p>}
                             <div className={`w-full h-40 mt-4 ${colors.bgPrimary} p-3 rounded-md overflow-y-auto border ${colors.border}`}>
                                <p className={`${colors.textPrimary} whitespace-pre-wrap`}>{transcription}</p>
                             </div>
                        </div>
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className={`text-xl font-semibold mb-3 ${colors.textAccent}`}>Saved Voice Notes</h3>
                            <div className="space-y-3 overflow-y-auto pr-2">
                                {voiceNotes.map(note => (
                                    <div key={note.id} className={`${colors.bgSecondary} p-4 rounded-lg border ${colors.border} relative group`}>
                                        <p className={`${colors.textPrimary}`}>{note.transcription}</p>
                                        <div className="flex justify-between items-center mt-2">
                                            <p className={`text-xs ${colors.textSecondary}`}>{note.createdAt.toLocaleString()}</p>
                                            {note.duration !== undefined && (
                                                <p className={`text-xs font-mono ${colors.textSecondary}`}>{formatDuration(note.duration)}</p>
                                            )}
                                        </div>
                                        <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleDownloadAsPDF(note.transcription, `VoiceNote_${note.id}`)} className={`p-1 ${colors.textSecondary} hover:text-sky-400`}>
                                                <DownloadIcon className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDeleteVoiceNote(note.id)} className={`p-1 ${colors.textSecondary} ${colors.dangerTextHover}`}>
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'todos':
                return (
                    <div className="flex flex-col h-full">
                        <h3 className={`text-xl font-semibold mb-3 ${colors.textAccent}`}>To-Do List</h3>
                        <div className="flex flex-col sm:flex-row gap-2 mb-4">
                            <input
                                type="text"
                                value={newTodo}
                                onChange={(e) => setNewTodo(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
                                placeholder="Add a new to-do item..."
                                className={`flex-grow p-2 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none`}
                            />
                            <select
                                value={newTodoPriority}
                                onChange={(e) => setNewTodoPriority(e.target.value as Priority)}
                                className={`p-2 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none`}
                            >
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                            </select>
                            <input
                                type="datetime-local"
                                value={newTodoReminder}
                                onChange={(e) => setNewTodoReminder(e.target.value)}
                                title="Set a reminder"
                                className={`p-2 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none ${colors.textSecondary}`}
                            />
                            <button onClick={handleAddTodo} className={`${colors.accent} ${colors.accentHover} ${colors.accentText} font-bold p-2 rounded-lg transition-colors flex items-center justify-center`}>
                                <PlusIcon className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="flex justify-between items-center mb-3">
                            <div></div>
                             <button 
                                onClick={() => setTodoSortOrder(prev => prev === 'priority' ? 'default' : 'priority')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${todoSortOrder === 'priority' ? `${colors.accent} ${colors.accentText}` : `${colors.bgTertiary} ${colors.textPrimary} ${colors.accentHover}`}`}
                            >
                                Sort by Priority {todoSortOrder === 'priority' ? '✓' : ''}
                            </button>
                        </div>


                        <div className="space-y-3 overflow-y-auto pr-2 flex-grow">
                            {sortedTodos.map(todo => (
                                <div key={todo.id} className={`flex items-center ${colors.bgSecondary} p-3 rounded-lg border ${colors.border} group`}>
                                    <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id)} className={`h-5 w-5 rounded ${colors.bgTertiary} ${colors.border} text-indigo-600 ${colors.accentFocusRing}`} />
                                    <div className="ml-3 flex-grow">
                                        {editingTodoId === todo.id ? (
                                            <input
                                                type="text"
                                                value={editingTodoText}
                                                onChange={(e) => setEditingTodoText(e.target.value)}
                                                onBlur={() => handleSaveEditTodo(todo.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEditTodo(todo.id);
                                                    if (e.key === 'Escape') handleCancelEditTodo();
                                                }}
                                                autoFocus
                                                className={`w-full p-0 border-0 focus:ring-0 ${colors.bgSecondary} ${colors.textPrimary}`}
                                            />
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <span 
                                                    className={`cursor-text ${colors.textPrimary} ${todo.completed ? `line-through ${colors.textSecondary}` : ''}`}
                                                    onDoubleClick={() => handleStartEditTodo(todo)}
                                                >
                                                    {todo.text}
                                                </span>
                                                <PriorityBadge priority={todo.priority} />
                                            </div>
                                        )}
                                        {todo.reminder && !todo.completed && (
                                            <div className={`flex items-center text-xs ${colors.warnText} mt-1`}>
                                                <BellIcon className="w-3 h-3 mr-1"/>
                                                <span>{new Date(todo.reminder).toLocaleString()}</span>
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => handleDeleteTodo(todo.id)} className={`ml-4 ${colors.textSecondary} ${colors.dangerTextHover} opacity-0 group-hover:opacity-100 transition-opacity`}>
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'calendar':
                return (
                     <div className="flex flex-col md:flex-row gap-6 h-full">
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className={`text-xl font-semibold mb-3 ${colors.textAccent}`}>Schedule Event</h3>
                            <p className={`text-sm ${colors.textSecondary} mb-2`}>Describe the event in natural language. E.g., "Schedule a marketing sync with Jane and Alex for tomorrow at 3pm to discuss Q3 results."</p>
                            <textarea
                                value={eventInput}
                                onChange={(e) => setEventInput(e.target.value)}
                                placeholder="Describe your event..."
                                className={`w-full h-24 p-4 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none resize-none`}
                            ></textarea>
                            
                            {/* Attendee Management */}
                            <div className={`mt-4 p-4 rounded-lg border ${colors.border} ${colors.bgSecondary}`}>
                                <h4 className={`font-semibold mb-2 ${colors.textHeader}`}>Add Attendees</h4>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input type="text" placeholder="Name" value={currentAttendee.name} onChange={e => setCurrentAttendee({...currentAttendee, name: e.target.value})} className={`flex-1 p-2 ${colors.bgPrimary} border ${colors.border} rounded-md focus:outline-none focus:ring-2 ${colors.accentFocusRing}`} />
                                    <input type="email" placeholder="Email" value={currentAttendee.email} onChange={e => setCurrentAttendee({...currentAttendee, email: e.target.value})} className={`flex-1 p-2 ${colors.bgPrimary} border ${colors.border} rounded-md focus:outline-none focus:ring-2 ${colors.accentFocusRing}`} />
                                    <input type="tel" placeholder="Phone (Optional)" value={currentAttendee.phone} onChange={e => setCurrentAttendee({...currentAttendee, phone: e.target.value})} className={`flex-1 p-2 ${colors.bgPrimary} border ${colors.border} rounded-md focus:outline-none focus:ring-2 ${colors.accentFocusRing}`} />
                                    <button onClick={handleAddAttendee} className={`p-2 rounded-md ${colors.accent} ${colors.accentText} ${colors.accentHover}`}><PlusIcon className="w-5 h-5"/></button>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {newEventAttendees.map((attendee, index) => (
                                        <div key={index} className={`flex items-center justify-between text-sm p-2 rounded-md ${colors.bgPrimary}`}>
                                            <div>
                                                <p className={`${colors.textPrimary}`}>{attendee.name}</p>
                                                <p className={`${colors.textSecondary}`}>{attendee.email}</p>
                                            </div>
                                            <button onClick={() => handleRemoveAttendee(index)} className={`${colors.textSecondary} ${colors.dangerTextHover}`}><TrashIcon className="w-4 h-4" /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center mt-4 gap-4">
                                <select 
                                    value={eventReminderMinutes ?? ''} 
                                    onChange={e => setEventReminderMinutes(e.target.value ? Number(e.target.value) : null)}
                                    className={`w-full p-2 ${colors.bgSecondary} border ${colors.border} rounded-lg focus:ring-2 ${colors.accentFocusRing} focus:outline-none`}
                                >
                                    <option value="">No reminder</option>
                                    <option value="5">5 minutes before</option>
                                    <option value="15">15 minutes before</option>
                                    <option value="30">30 minutes before</option>
                                    <option value="60">1 hour before</option>
                                </select>
                                <button onClick={handleScheduleEvent} disabled={isScheduling} className={`w-full ${colors.accent} ${colors.accentHover} ${colors.accentText} font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center ${colors.buttonDisabled}`}>
                                    {isScheduling ? <SpinnerIcon className="w-5 h-5 mr-2" /> : null}
                                    {isScheduling ? 'Scheduling...' : 'Schedule with AI'}
                                </button>
                            </div>
                        </div>
                        <div className="md:w-1/2 flex flex-col">
                             <h3 className={`text-xl font-semibold mb-3 ${colors.textAccent}`}>Upcoming Events</h3>
                             <div className="space-y-3 overflow-y-auto pr-2">
                                {calendarEvents.map(event => (
                                    <div key={event.id} className={`${colors.bgSecondary} p-4 rounded-lg border ${colors.border} relative group`}>
                                        <h4 className={`font-bold ${colors.textAccent}`}>{event.title}</h4>
                                        <p className={`${colors.textPrimary}`}>{event.date} at {event.time}</p>
                                        {event.description && <p className={`text-sm ${colors.textSecondary} mt-1`}>{event.description}</p>}
                                        {event.attendees && event.attendees.length > 0 && (
                                            <div className="mt-2 pt-2 border-t border-slate-700">
                                                <h5 className={`text-sm font-semibold ${colors.textHeader} mb-1 flex items-center`}><UserIcon className="w-4 h-4 mr-2" /> Attendees:</h5>
                                                <ul className="space-y-1">
                                                    {event.attendees.map((a, i) => (
                                                        <li key={i} className={`text-xs ${colors.textSecondary}`}>
                                                            <span className={`${colors.textPrimary}`}>{a.name}</span>
                                                            {a.email && <a href={`mailto:${a.email}`} className={`ml-2 ${colors.textAccent} ${colors.textAccentHover}`}> {a.email}</a>}
                                                            {a.phone && <a href={`tel:${a.phone}`} className={`ml-2 ${colors.textAccent} ${colors.textAccentHover}`}> {a.phone}</a>}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {event.reminder !== undefined && event.reminder !== null && (
                                            <p className={`text-sm ${colors.textSecondary} mt-1 flex items-center`}>
                                                <BellIcon className={`w-4 h-4 mr-1 ${colors.warnText}`}/>
                                                <span>Reminder: {event.reminder} minutes before</span>
                                            </p>
                                        )}
                                         <button onClick={() => handleDeleteEvent(event.id)} className={`absolute top-2 right-2 p-1 ${colors.textSecondary} ${colors.dangerTextHover} opacity-0 group-hover:opacity-100 transition-opacity`}>
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'settings':
                return (
                    <div className="flex flex-col h-full">
                        <h3 className={`text-xl font-semibold mb-4 ${colors.textAccent}`}>Settings</h3>
                        <div className={`${colors.bgSecondary} p-6 rounded-lg border ${colors.border}`}>
                            <h4 className={`text-lg font-medium mb-3 ${colors.textPrimary}`}>Color Theme</h4>
                            <div className="flex gap-4">
                                {Object.values(themes).map(themeOption => (
                                    <button
                                        key={themeOption.name}
                                        onClick={() => setTheme(themeOption.name)}
                                        className={`px-6 py-3 rounded-lg font-semibold capitalize transition-all ${
                                            theme.name === themeOption.name
                                                ? `${colors.accent} ${colors.accentText}`
                                                : `${colors.bgTertiary} ${colors.accentHover} ${colors.accentText}`
                                        }`}
                                    >
                                        {themeOption.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    };
    
    return (
        <div className={`flex h-screen ${colors.bgPrimary} ${colors.textPrimary}`}>
            {/* Sidebar */}
            <nav className={`w-20 ${colors.bgSecondary} p-4 flex flex-col items-center justify-between border-r ${colors.border}`}>
                <div>
                     <div className="flex items-center mb-10">
                        <NoteIcon className={`h-8 w-8 ${colors.iconAccent}`} />
                    </div>
                    <div className="space-y-6">
                        <button onClick={() => setActiveView('notes')} className={`p-3 rounded-lg transition-colors ${activeView === 'notes' ? colors.accent : `hover:${colors.bgTertiary}`}`}><NoteIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('voice')} className={`p-3 rounded-lg transition-colors ${activeView === 'voice' ? colors.accent : `hover:${colors.bgTertiary}`}`}><MicIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('todos')} className={`p-3 rounded-lg transition-colors ${activeView === 'todos' ? colors.accent : `hover:${colors.bgTertiary}`}`}><TodoIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('calendar')} className={`p-3 rounded-lg transition-colors ${activeView === 'calendar' ? colors.accent : `hover:${colors.bgTertiary}`}`}><CalendarIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('settings')} className={`p-3 rounded-lg transition-colors ${activeView === 'settings' ? colors.accent : `hover:${colors.bgTertiary}`}`}><SettingsIcon className="h-6 w-6" /></button>
                    </div>
                </div>
                <div>
                     <button onClick={onLogout} className={`p-3 rounded-lg hover:${colors.bgTertiary} transition-colors`}>
                        <LogoutIcon className={`h-6 w-6 ${colors.iconSecondary}`} />
                    </button>
                </div>
            </nav>
            {/* Main Content */}
            <main className="flex-1 flex flex-col">
                {/* Header */}
                <header className={`flex justify-between items-center p-4 ${colors.bgSecondary} border-b ${colors.border}`}>
                     <div>
                        <h2 className={`text-2xl font-bold ${colors.textHeader}`}>Welcome, {user?.name.split(' ')[0] || 'User'}!</h2>
                        <p className={`text-sm ${colors.textSecondary}`}>IWA Note Dashboard</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <p className={`text-sm ${colors.successText}`}>All changes saved automatically.</p>
                    </div>
                </header>
                {/* Content Area */}
                <div className="flex-1 p-6 overflow-hidden">
                    {renderContent()}
                </div>
                 {showSaveConfirmation && (
                    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
                        <div className={`${colors.bgSecondary} p-6 rounded-lg shadow-xl border ${colors.border} w-full max-w-sm`}>
                            <h3 className={`text-lg font-semibold mb-4 ${colors.textHeader}`}>Confirm Save</h3>
                            <p className={`${colors.textSecondary} mb-6`}>Are you sure you want to save this note?</p>
                            <div className="flex justify-end gap-4">
                                <button 
                                    onClick={() => setShowSaveConfirmation(false)} 
                                    className={`px-4 py-2 rounded-lg ${colors.bgTertiary} ${colors.textPrimary} hover:opacity-80 transition-opacity`}
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={confirmAndSaveNote} 
                                    className={`px-4 py-2 rounded-lg ${colors.accent} ${colors.accentText} ${colors.accentHover} transition-colors`}
                                >
                                    Save Note
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default Dashboard;