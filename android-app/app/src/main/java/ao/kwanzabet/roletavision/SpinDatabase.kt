package ao.kwanzabet.roletavision

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class SpinDatabase(context: Context) :
    SQLiteOpenHelper(context, "roleta_vision.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE spins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number INTEGER NOT NULL,
                source TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS spins")
        onCreate(db)
    }

    fun insertSpinsOldestFirst(numbers: List<Int>, source: String) {
        if (numbers.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            numbers.forEachIndexed { index, num ->
                if (num in 0..36) {
                    val values = ContentValues().apply {
                        put("number", num)
                        put("source", source)
                        put("created_at", now + index)
                    }
                    db.insert("spins", null, values)
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /**
     * Retorna os giros mais recentes primeiro (index 0 = ultimo numero que caiu).
     */
    fun getSpinsNewestFirst(limit: Int = 500): List<Int> {
        val list = mutableListOf<Int>()
        val db = readableDatabase
        db.rawQuery(
            "SELECT number FROM spins ORDER BY id DESC LIMIT ?",
            arrayOf(limit.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                list.add(cursor.getInt(0))
            }
        }
        return list
    }

    fun clearAll() {
        writableDatabase.delete("spins", null, null)
    }
}
