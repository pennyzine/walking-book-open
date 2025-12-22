export interface WalkingBookMetadata {
  title: string
  author: string
  voice: string
  speed: number
  format_version: string
  version: number
  chunk_count: number
  total_words: number
  audio_format: string
  audio_bitrate: string
  naturalness_optimized: boolean
}

export interface TimestampSegment {
  text: string
  start_time: number
  end_time: number
  duration: number
  original_start_char?: number
  original_end_char?: number
}

export interface ChunkData {
  chunk_id: string
  title: string
  word_count: number
  text_hash: string
  audio_file: string
  version: number
  last_modified: string
  status: "new" | "modified" | "original"
  timestamps: TimestampSegment[]
}

export interface ManifestData {
  version: number
  created: string
  chunks: ChunkData[]
}

export interface VoiceEdit {
  id: string
  timestamp: number
  chunkId: string
  chunkIndex?: number
  segmentIndex: number
  editType: "last-line" | "last-paragraph" | "custom"
  transcription: string
  audioBlob?: Blob
  createdAt: string
}

export interface SessionData {
  userName: string
  currentChunkId: string
  currentAudioFile?: string
  currentTime: number
  cursorPosition?: number
  lastUpdated: string
  edits: VoiceEdit[]
  textScrollPosition?: number
}

export interface StoredAudiobook {
  id: string
  metadata: WalkingBookMetadata
  manifest: ManifestData
  audioFiles: Map<string, Blob>
  versionHistory: Map<string, string>
  session: SessionData
  uploadedAt: string
}
