// installer/engine/Json.cs
// ---------------------------------------------------------------------------
// Bounded JSON via System.Web.Script.Serialization.JavaScriptSerializer.
//
// DeserializeObject yields Dictionary<string,object> for objects, object[] for
// arrays and boxed primitives for scalars. We NEVER map to typed classes; every
// field is pulled out and validated explicitly so a hostile request cannot
// smuggle unexpected shapes past us. Length and depth are bounded up front.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace Backseat.Installer
{
    internal static class Json
    {
        // Generous but finite. The real manifest (~2400 files) serialises well
        // under this; anything larger is rejected rather than buffered forever.
        public const int MaxJsonLength = 64 * 1024 * 1024;
        public const int MaxRecursion = 32;

        public static object Parse(string text)
        {
            if (text == null) throw EngineError.Validation("JSON text is null");
            if (text.Length > MaxJsonLength)
                throw EngineError.Validation("JSON exceeds maximum length");
            // Strip a leading UTF-8 BOM if the file was written with one.
            if (text.Length > 0 && text[0] == '﻿') text = text.Substring(1);
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = MaxJsonLength;
            s.RecursionLimit = MaxRecursion;
            try
            {
                return s.DeserializeObject(text);
            }
            catch (Exception e)
            {
                throw EngineError.Validation("malformed JSON: " + e.Message);
            }
        }

        public static string Serialize(object o)
        {
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = MaxJsonLength;
            return s.Serialize(o);
        }

        public static Dictionary<string, object> AsObject(object o, string ctx)
        {
            var d = o as Dictionary<string, object>;
            if (d == null) throw EngineError.Validation(ctx + ": expected an object");
            return d;
        }

        public static object[] AsArray(object o, string ctx)
        {
            var a = o as object[];
            if (a == null) throw EngineError.Validation(ctx + ": expected an array");
            return a;
        }

        public static object Get(Dictionary<string, object> m, string key)
        {
            object v;
            if (!m.TryGetValue(key, out v)) return null;
            return v;
        }

        public static string GetString(Dictionary<string, object> m, string key, string ctx)
        {
            object v = Get(m, key);
            var s = v as string;
            if (s == null) throw EngineError.Validation(ctx + "." + key + ": expected a string");
            return s;
        }

        public static string GetStringOrNull(Dictionary<string, object> m, string key)
        {
            object v = Get(m, key);
            return v as string;
        }

        public static long GetLong(Dictionary<string, object> m, string key, string ctx)
        {
            object v = Get(m, key);
            if (v == null) throw EngineError.Validation(ctx + "." + key + ": expected a number");
            try
            {
                // JavaScriptSerializer boxes integers as Int32/Int64/Decimal.
                if (v is bool) throw new Exception();
                return Convert.ToInt64(v);
            }
            catch
            {
                throw EngineError.Validation(ctx + "." + key + ": expected an integer");
            }
        }
    }
}
