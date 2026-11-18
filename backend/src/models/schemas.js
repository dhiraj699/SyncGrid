import mongoose from 'mongoose';

const { Schema } = mongoose;
const baseOptions = { versionKey: false, minimize: false };

const userSchema = new Schema(
  {
    _id: String,
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    initials: { type: String, required: true },
    color: { type: String, required: true },
    role: { type: String, enum: ['ADMIN', 'MANAGER', 'STAFF'], required: true },
    passwordHash: { type: String, required: true },
  },
  { ...baseOptions, collection: 'users' },
);

const sheetSchema = new Schema(
  {
    _id: String,
    name: { type: String, required: true },
    rowCount: { type: Number, required: true },
    baselineSeq: { type: Number, default: 0 },
    columns: { type: [Schema.Types.Mixed], default: [] },
    seedVersion: String,
  },
  { ...baseOptions, collection: 'sheets', timestamps: true },
);

const cellMutationEventSchema = new Schema(
  {
    sheetId: { type: String, required: true },
    seq: { type: Number, required: true },
    opId: { type: String, required: true },
    cellId: { type: String, required: true },
    opType: { type: String, enum: ['SET', 'CLEAR'], required: true },
    value: Schema.Types.Mixed,
    previousValue: Schema.Types.Mixed,
    formula: String,
    authorId: { type: String, required: true },
    authorRole: { type: String, required: true },
    authorName: String,
    vectorClock: { type: Schema.Types.Mixed, default: {} },
    lamport: { type: Number, default: 0 },
    clientTimestamp: Number,
    timestamp: { type: Number, required: true },
  },
  { ...baseOptions, collection: 'cell_mutation_events' },
);
cellMutationEventSchema.index({ sheetId: 1, seq: 1 }, { unique: true });
cellMutationEventSchema.index({ sheetId: 1, opId: 1 }, { unique: true });
cellMutationEventSchema.index({ sheetId: 1, timestamp: 1 });
cellMutationEventSchema.index({ sheetId: 1, cellId: 1 });
cellMutationEventSchema.index({ sheetId: 1, cellId: 1, seq: -1 });
cellMutationEventSchema.index({ opId: 1 }, { unique: true, sparse: true });

/** The event log is append-only: every query-level mutation path is blocked. */
for (const operation of ['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  cellMutationEventSchema.pre(operation, { document: false, query: true }, () => {
    throw new Error('cell_mutation_events is append-only');
  });
}

const cellStateSchema = new Schema(
  {
    sheetId: { type: String, required: true },
    cellId: { type: String, required: true },
    value: Schema.Types.Mixed,
    formula: String,
    revision: { type: Number, required: true },
    lamport: { type: Number, default: 0 },
    authorId: String,
    authorRole: String,
    authorName: String,
    opId: String,
    vectorClock: { type: Schema.Types.Mixed, default: {} },
  },
  { ...baseOptions, collection: 'cell_states' },
);
cellStateSchema.index({ sheetId: 1, cellId: 1 }, { unique: true });

export const UserModel = mongoose.models.User ?? mongoose.model('User', userSchema);
export const SheetModel = mongoose.models.Sheet ?? mongoose.model('Sheet', sheetSchema);
export const CellMutationEventModel = mongoose.models.CellMutationEvent ?? mongoose.model('CellMutationEvent', cellMutationEventSchema);
export const CellStateModel = mongoose.models.CellState ?? mongoose.model('CellState', cellStateSchema);
