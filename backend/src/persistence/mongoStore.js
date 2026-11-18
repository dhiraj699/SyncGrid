import mongoose from 'mongoose';
import { CellMutationEventModel, CellStateModel, SheetModel, UserModel } from '../models/schemas.js';

const DUPLICATE_KEY = 11000;

const isDuplicateOnly = (error) => {
  if (error?.code === DUPLICATE_KEY && (!error.writeErrors || error.writeErrors.length === 0)) return true;
  const writeErrors = error?.writeErrors ?? [];
  return writeErrors.length > 0 && writeErrors.every((entry) => (entry.code ?? entry.err?.code) === DUPLICATE_KEY);
};

const toUser = (doc) => (doc ? { id: doc._id, email: doc.email, name: doc.name, initials: doc.initials, color: doc.color, role: doc.role, passwordHash: doc.passwordHash } : null);
const toSheet = (doc) => (doc ? { id: doc._id, name: doc.name, rowCount: doc.rowCount, baselineSeq: doc.baselineSeq, columns: doc.columns, seedVersion: doc.seedVersion } : null);
const stripInternal = ({ _id, ...rest }) => rest;

export class MongoStore {
  constructor({ uri }) {
    this.uri = uri;
  }

  async connect() {
    await mongoose.connect(this.uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 10_000 });
    await Promise.all([UserModel, SheetModel, CellMutationEventModel, CellStateModel].map((model) => model.init()));
  }

  disconnect() {
    return mongoose.disconnect();
  }

  async upsertUsers(users) {
    await UserModel.bulkWrite(
      users.map(({ id, ...fields }) => ({ updateOne: { filter: { _id: id }, update: { $set: fields }, upsert: true } })),
    );
  }
  async findUserById(id) {
    return toUser(await UserModel.findById(id).lean());
  }
  async findUserByEmail(email) {
    return toUser(await UserModel.findOne({ email }).lean());
  }
  async listUsers() {
    return (await UserModel.find().lean()).map(toUser);
  }

  async getSheet(sheetId) {
    return toSheet(await SheetModel.findById(sheetId).lean());
  }
  async saveSheet({ id, ...fields }) {
    await SheetModel.updateOne({ _id: id }, { $set: fields }, { upsert: true });
  }
  async listSheets() {
    const sheets = await SheetModel.find().lean();
    return sheets.map((sheet) => ({ id: sheet._id, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columns.length }));
  }
  async clearSheet(sheetId) {
    await Promise.all([
      SheetModel.deleteOne({ _id: sheetId }),
      CellMutationEventModel.collection.deleteMany({ sheetId }),
      CellStateModel.collection.deleteMany({ sheetId }),
    ]);
  }

  async loadSheetState(sheetId) {
    const [cellStates, lastEvent] = await Promise.all([
      CellStateModel.find({ sheetId }).lean(),
      CellMutationEventModel.findOne({ sheetId }).sort({ seq: -1 }).select('seq').lean(),
    ]);
    return { cellStates, lastEventSeq: lastEvent?.seq ?? 0 };
  }

  async loadEvents(sheetId, { afterSeq = 0, untilSeq = Infinity, limit = 5000 } = {}) {
    const seq = Number.isFinite(untilSeq) ? { $gt: afterSeq, $lte: untilSeq } : { $gt: afterSeq };
    const docs = await CellMutationEventModel.find({ sheetId, seq }).sort({ seq: 1 }).limit(limit).lean();
    return docs.map(stripInternal);
  }

  async bulkPersist({ sheetId, events, cellStates }) {
    if (events.length > 0) {
      try {
        await CellMutationEventModel.insertMany(events, { ordered: false });
      } catch (error) {
        if (!isDuplicateOnly(error)) throw error;
      }
    }
    if (cellStates.length > 0) {
      await CellStateModel.bulkWrite(
        cellStates.map(({ cellId, ...state }) => ({
          updateOne: { filter: { sheetId, cellId }, update: { $set: state }, upsert: true },
        })),
        { ordered: false },
      );
    }
  }
}
