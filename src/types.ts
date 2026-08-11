export interface Lesson {
  dayNumber: number;
  aramaicPhrase: string;
  syriacScript: string;
  phoneticBreakdown: string;
  englishTranslation: string;
  explanation: string;
}

export interface Progress {
  dayNumber: number;
  passed: boolean;
  accuracyScore: number;
}

export interface UserState {
  xp: number;
  currentDay: number;
  completedDays: number[];
  bestScores: { [dayNumber: number]: number };
}

export interface OrderDetails {
  fullName: string;
  email: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvc: string;
}
