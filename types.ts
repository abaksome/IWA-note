
export interface Note {
  id: string;
  content: string;
  createdAt: Date;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  reminder?: string; // ISO string for the reminder date/time
  notified?: boolean; // To prevent duplicate notifications
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  attendees?: string[];
  description?: string;
  reminder?: number; // Minutes before the event
  notified?: boolean; // To prevent duplicate notifications
}

export interface VoiceNote {
  id: string;
  transcription: string;
  createdAt: Date;
}

export type ActiveView = 'notes' | 'voice' | 'todos' | 'calendar';