package com.roletavision.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Base de dados SQLite local persistente para todos os resultados capturados:
 * - resultados_roleta
 * - resultados_bacbo
 * - crashes_aviator
 * - sessoes
 */
public class GameHistoryDb extends SQLiteOpenHelper {

    private static final String DB_NAME = "roletavision_history.db";
    private static final int DB_VERSION = 1;
    private static final int MAX_QUERY_LIMIT = 500;

    private static volatile GameHistoryDb instance;

    public static GameHistoryDb getInstance(Context context) {
        if (instance == null) {
            synchronized (GameHistoryDb.class) {
                if (instance == null) {
                    instance = new GameHistoryDb(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    private GameHistoryDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS resultados_roleta ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "timestamp_ms INTEGER NOT NULL,"
                + "site TEXT NOT NULL,"
                + "head_number INTEGER NOT NULL,"
                + "numbers_json TEXT NOT NULL,"
                + "confidence REAL NOT NULL,"
                + "source TEXT NOT NULL"
                + ")");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_roleta_ts ON resultados_roleta(timestamp_ms DESC)");

        db.execSQL("CREATE TABLE IF NOT EXISTS resultados_bacbo ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "timestamp_ms INTEGER NOT NULL,"
                + "site TEXT NOT NULL,"
                + "outcome TEXT NOT NULL,"
                + "player_total INTEGER NOT NULL,"
                + "banker_total INTEGER NOT NULL,"
                + "scan_mode TEXT NOT NULL,"
                + "confidence REAL NOT NULL,"
                + "source TEXT NOT NULL"
                + ")");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_bacbo_ts ON resultados_bacbo(timestamp_ms DESC)");

        db.execSQL("CREATE TABLE IF NOT EXISTS crashes_aviator ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "timestamp_ms INTEGER NOT NULL,"
                + "site TEXT NOT NULL,"
                + "multiplier REAL NOT NULL,"
                + "is_crash INTEGER NOT NULL,"
                + "confidence REAL NOT NULL,"
                + "source TEXT NOT NULL"
                + ")");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_aviator_ts ON crashes_aviator(timestamp_ms DESC)");

        db.execSQL("CREATE TABLE IF NOT EXISTS sessoes ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "game TEXT NOT NULL,"
                + "site TEXT NOT NULL,"
                + "started_at INTEGER NOT NULL,"
                + "ended_at INTEGER,"
                + "initial_bankroll REAL,"
                + "final_bankroll REAL,"
                + "total_rounds INTEGER DEFAULT 0,"
                + "notes TEXT"
                + ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Sem migrações destrutivas na v1
    }

    public void insertRouletteResult(
            long timestampMs,
            String site,
            List<Integer> numbersNewestFirst,
            float confidence,
            String source
    ) {
        if (numbersNewestFirst == null || numbersNewestFirst.isEmpty()) return;
        try {
            JSONArray arr = new JSONArray();
            for (Integer n : numbersNewestFirst) {
                arr.put(n);
            }
            ContentValues cv = new ContentValues();
            cv.put("timestamp_ms", timestampMs);
            cv.put("site", RoiConfigStore.normalizeSite(site));
            cv.put("head_number", numbersNewestFirst.get(0));
            cv.put("numbers_json", arr.toString());
            cv.put("confidence", confidence);
            cv.put("source", source != null ? source : "ocr");
            getWritableDatabase().insert("resultados_roleta", null, cv);
        } catch (Exception ignored) {
        }
    }

    public void insertBacBoResult(
            long timestampMs,
            String site,
            String outcome,
            int playerTotal,
            int bankerTotal,
            String scanMode,
            float confidence,
            String source
    ) {
        if (outcome == null || outcome.isEmpty()) return;
        try {
            ContentValues cv = new ContentValues();
            cv.put("timestamp_ms", timestampMs);
            cv.put("site", RoiConfigStore.normalizeSite(site));
            cv.put("outcome", outcome);
            cv.put("player_total", playerTotal);
            cv.put("banker_total", bankerTotal);
            cv.put("scan_mode", scanMode != null ? scanMode : RoiConfigStore.BACBO_MODE_AUTO);
            cv.put("confidence", confidence);
            cv.put("source", source != null ? source : "ocr");
            getWritableDatabase().insert("resultados_bacbo", null, cv);
        } catch (Exception ignored) {
        }
    }

    public void insertAviatorCrash(
            long timestampMs,
            String site,
            double multiplier,
            boolean isCrash,
            float confidence,
            String source
    ) {
        if (multiplier < 1.0) return;
        try {
            ContentValues cv = new ContentValues();
            cv.put("timestamp_ms", timestampMs);
            cv.put("site", RoiConfigStore.normalizeSite(site));
            cv.put("multiplier", multiplier);
            cv.put("is_crash", isCrash ? 1 : 0);
            cv.put("confidence", confidence);
            cv.put("source", source != null ? source : "ocr");
            getWritableDatabase().insert("crashes_aviator", null, cv);
        } catch (Exception ignored) {
        }
    }

    public void recordSessionSummary(
            String game,
            String site,
            long startedAt,
            long endedAt,
            double initialBankroll,
            double finalBankroll,
            int totalRounds,
            String notes
    ) {
        try {
            ContentValues cv = new ContentValues();
            cv.put("game", RoiConfigStore.normalizeGame(game));
            cv.put("site", RoiConfigStore.normalizeSite(site));
            cv.put("started_at", startedAt);
            cv.put("ended_at", endedAt);
            cv.put("initial_bankroll", initialBankroll);
            cv.put("final_bankroll", finalBankroll);
            cv.put("total_rounds", totalRounds);
            cv.put("notes", notes != null ? notes : "");
            getWritableDatabase().insert("sessoes", null, cv);
        } catch (Exception ignored) {
        }
    }

    public JSONArray queryRecent(String game, int requestedLimit) {
        int limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, requestedLimit));
        String g = RoiConfigStore.normalizeGame(game);
        JSONArray out = new JSONArray();
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = null;
        try {
            if (RoiConfigStore.GAME_BACBO.equals(g)) {
                c = db.rawQuery(
                        "SELECT id, timestamp_ms, site, outcome, player_total, banker_total, scan_mode, confidence, source "
                                + "FROM resultados_bacbo ORDER BY timestamp_ms DESC LIMIT ?",
                        new String[]{String.valueOf(limit)}
                );
                while (c.moveToNext()) {
                    JSONObject row = new JSONObject();
                    row.put("id", c.getLong(0));
                    row.put("timestampMs", c.getLong(1));
                    row.put("site", c.getString(2));
                    row.put("outcome", c.getString(3));
                    row.put("playerTotal", c.getInt(4));
                    row.put("bankerTotal", c.getInt(5));
                    row.put("scanMode", c.getString(6));
                    row.put("confidence", c.getDouble(7));
                    row.put("source", c.getString(8));
                    out.put(row);
                }
            } else if (RoiConfigStore.GAME_AVIATOR.equals(g)) {
                c = db.rawQuery(
                        "SELECT id, timestamp_ms, site, multiplier, is_crash, confidence, source "
                                + "FROM crashes_aviator ORDER BY timestamp_ms DESC LIMIT ?",
                        new String[]{String.valueOf(limit)}
                );
                while (c.moveToNext()) {
                    JSONObject row = new JSONObject();
                    row.put("id", c.getLong(0));
                    row.put("timestampMs", c.getLong(1));
                    row.put("site", c.getString(2));
                    row.put("multiplier", c.getDouble(3));
                    row.put("isCrash", c.getInt(4) == 1);
                    row.put("confidence", c.getDouble(5));
                    row.put("source", c.getString(6));
                    out.put(row);
                }
            } else {
                c = db.rawQuery(
                        "SELECT id, timestamp_ms, site, head_number, numbers_json, confidence, source "
                                + "FROM resultados_roleta ORDER BY timestamp_ms DESC LIMIT ?",
                        new String[]{String.valueOf(limit)}
                );
                while (c.moveToNext()) {
                    JSONObject row = new JSONObject();
                    row.put("id", c.getLong(0));
                    row.put("timestampMs", c.getLong(1));
                    row.put("site", c.getString(2));
                    row.put("headNumber", c.getInt(3));
                    try {
                        row.put("numbers", new JSONArray(c.getString(4)));
                    } catch (JSONException e) {
                        row.put("numbers", new JSONArray());
                    }
                    row.put("confidence", c.getDouble(5));
                    row.put("source", c.getString(6));
                    out.put(row);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    public String exportCsv(String game) {
        String g = RoiConfigStore.normalizeGame(game);
        StringBuilder sb = new StringBuilder();
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = null;
        try {
            if (RoiConfigStore.GAME_BACBO.equals(g)) {
                sb.append("id,timestamp_iso,site,outcome,player_total,banker_total,scan_mode,confidence,source\n");
                c = db.rawQuery(
                        "SELECT id, timestamp_ms, site, outcome, player_total, banker_total, scan_mode, confidence, source "
                                + "FROM resultados_bacbo ORDER BY timestamp_ms DESC LIMIT 2000",
                        null
                );
                while (c.moveToNext()) {
                    sb.append(c.getLong(0)).append(',')
                      .append(fmt.format(new Date(c.getLong(1)))).append(',')
                      .append(escapeCsv(c.getString(2))).append(',')
                      .append(escapeCsv(c.getString(3))).append(',')
                      .append(c.getInt(4)).append(',')
                      .append(c.getInt(5)).append(',')
                      .append(escapeCsv(c.getString(6))).append(',')
                      .append(String.format(Locale.US, "%.2f", c.getDouble(7))).append(',')
                      .append(escapeCsv(c.getString(8))).append('\n');
                }
            } else if (RoiConfigStore.GAME_AVIATOR.equals(g)) {
                sb.append("id,timestamp_iso,site,multiplier,is_crash,confidence,source\n");
                c = db.rawQuery(
                        "SELECT id, timestamp_ms, site, multiplier, is_crash, confidence, source "
                                + "FROM crashes_aviator ORDER BY timestamp_ms DESC LIMIT 2000",
                        null
                );
                while (c.moveToNext()) {
                    sb.append(c.getLong(0)).append(',')
                      .append(fmt.format(new Date(c.getLong(1)))).append(',')
                      .append(escapeCsv(c.getString(2))).append(',')
                      .append(String.format(Locale.US, "%.2f", c.getDouble(3))).append(',')
                      .append(c.getInt(4)).append(',')
                      .append(String.format(Locale.US, "%.2f", c.getDouble(5))).append(',')
                      .append(escapeCsv(c.getString(6))).append('\n');
                }
            } else {
                sb.append("id,timestamp_iso,site,head_number,numbers,confidence,source\n");
                c = db.rawQuery(
                        "SELECT id, timestamp_ms, site, head_number, numbers_json, confidence, source "
                                + "FROM resultados_roleta ORDER BY timestamp_ms DESC LIMIT 2000",
                        null
                );
                while (c.moveToNext()) {
                    sb.append(c.getLong(0)).append(',')
                      .append(fmt.format(new Date(c.getLong(1)))).append(',')
                      .append(escapeCsv(c.getString(2))).append(',')
                      .append(c.getInt(3)).append(',')
                      .append(escapeCsv(c.getString(4))).append(',')
                      .append(String.format(Locale.US, "%.2f", c.getDouble(5))).append(',')
                      .append(escapeCsv(c.getString(6))).append('\n');
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return sb.toString();
    }

    public void clearGame(String game) {
        String g = RoiConfigStore.normalizeGame(game);
        SQLiteDatabase db = getWritableDatabase();
        if (RoiConfigStore.GAME_BACBO.equals(g)) {
            db.delete("resultados_bacbo", null, null);
        } else if (RoiConfigStore.GAME_AVIATOR.equals(g)) {
            db.delete("crashes_aviator", null, null);
        } else {
            db.delete("resultados_roleta", null, null);
        }
    }

    private static String escapeCsv(String v) {
        if (v == null) return "";
        if (v.contains(",") || v.contains("\"") || v.contains("\n")) {
            return "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }
}
