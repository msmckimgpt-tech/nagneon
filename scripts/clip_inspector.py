"""Bounded, file-only WebM validation. Binary stdin; one small JSON result.

No model loading, file/URL inputs, transcript output or media persistence.
The parent terminates this single-use process after 15 seconds or cancellation.
"""
import io
import json
import math
import sys

MAX_BYTES = 20 * 1024 * 1024
LEVEL1 = {0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1F43B675,
          0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367}
MASTERS = {0x1A45DFA3, 0x18538067, 0x1549A966, 0x1654AE6B,
           0xAE, 0xE0, 0xE1, 0x1F43B675, 0xA0}


def require(ok):
    if not ok:
        raise ValueError("invalid clip")


def webm_structure(data):
    """Reject partial elements even when a tolerant demuxer can recover them.

    Live MediaRecorder output may have unknown Segment/Cluster sizes. A sibling
    level-1 element ends an unknown Cluster. Opaque extension elements must still
    fit their parent. This is a bounded media-envelope check, not an EBML editor.
    """
    count = 0
    found = []
    doctype = None

    def vint(pos, end, element_id=False):
        require(pos < end and data[pos] != 0)
        width = 1
        marker = 0x80
        while not data[pos] & marker:
            marker >>= 1
            width += 1
        require(width <= (4 if element_id else 8) and pos + width <= end)
        value = int.from_bytes(data[pos:pos + width], 'big')
        if not element_id:
            value &= (1 << (7 * width)) - 1
            if value == (1 << (7 * width)) - 1:
                value = None
        return value, pos + width

    def walk(start, end, parent=None, unknown=False, depth=0):
        nonlocal count, doctype
        require(depth <= 8)
        pos = start
        while pos < end:
            element, body = vint(pos, end, True)
            if parent == 0x1F43B675 and element in LEVEL1:
                require(unknown)
                return pos
            size, body = vint(body, end)
            require(size is not None or element in (0x18538067, 0x1F43B675))
            limit = end if size is None else body + size
            require(limit <= end)
            count += 1
            require(count <= 100000)
            if parent is None:
                require(element in (0x1A45DFA3, 0x18538067, 0xEC))
                if element != 0xEC:
                    found.append(element)
            if element == 0x4282 and parent == 0x1A45DFA3:
                require(doctype is None)
                doctype = data[body:limit]
            if element in MASTERS:
                pos = walk(body, limit, element, size is None, depth + 1)
                require(size is None or pos == limit)
            else:
                pos = limit
        return pos

    require(100 <= len(data) <= MAX_BYTES)
    walk(0, len(data))
    require(found == [0x1A45DFA3, 0x18538067] and doctype == b'webm')


def inspect(data, kind, has_audio, expected_ms):
    require(kind in ('audio', 'video') and type(has_audio) is bool)
    require(math.isfinite(expected_ms) and 0 < expected_ms <= 45000)
    require(kind != 'audio' or has_audio)
    webm_structure(data)
    import av
    # Native decoder diagnostics can otherwise include arbitrary metadata. They
    # remain in this process and are reduced to a rejection, never returned.
    av.logging.set_level(av.logging.ERROR)
    with av.logging.Capture() as logs:
        with av.open(io.BytesIO(data), 'r', format='matroska',
                     options={'err_detect': 'explode', 'probesize': '1048576',
                              'analyzeduration': '0'}) as container:
            streams = list(container.streams)
            require(len(streams) == (1 if kind == 'audio' or not has_audio else 2))
            require(len(container.streams.video) == (kind == 'video'))
            require(len(container.streams.audio) == has_audio)
            totals = {}
            for stream in streams:
                ctx = stream.codec_context
                require((stream.type, ctx.name) in (('video', 'vp8'), ('audio', 'opus')))
                ctx.thread_count = 1
                ctx.options = {'err_detect': 'explode', 'max_pixels': str(8192 * 4320)}
                if stream.type == 'video':
                    require(0 < ctx.width <= 8192 and 0 < ctx.height <= 4320)
                else:
                    require(0 < ctx.sample_rate <= 48000 and 0 < ctx.channels <= 2)
                totals[stream.index] = {'type': stream.type, 'frames': 0, 'first': None, 'end': 0, 'last': None}
            packets = pixels = samples = 0
            for packet in container.demux():
                packets += 1
                require(packets <= 30000 and not packet.is_corrupt)
                total = totals[packet.stream.index]
                if total['type'] == 'video' and packet.size:
                    # VP8 keyframes carry their own dimensions, which may differ
                    # from track metadata. Reject before allocating frame buffers.
                    prefix = bytes(packet)[:10]
                    if not prefix[0] & 1:
                        require(len(prefix) == 10 and prefix[3:6] == b'\x9d\x01\x2a')
                        width = int.from_bytes(prefix[6:8], 'little') & 0x3fff
                        height = int.from_bytes(prefix[8:10], 'little') & 0x3fff
                        require(0 < width <= 8192 and 0 < height <= 4320)
                for frame in packet.decode():
                    require(not frame.is_corrupt and frame.pts is not None and frame.time_base is not None)
                    at = float(frame.pts * frame.time_base)
                    require(math.isfinite(at) and -0.1 <= at <= 46)
                    require(total['last'] is None or at >= total['last'] - 0.002)
                    total['last'] = at
                    if total['first'] is None:
                        require(at <= 2)
                        total['first'] = at
                    total['frames'] += 1
                    require(total['frames'] <= 10000)
                    if total['type'] == 'video':
                        require(0 < frame.width <= 8192 and 0 < frame.height <= 4320)
                        pixels += frame.width * frame.height
                        require(pixels <= 12_000_000_000)
                        duration = float(frame.duration * frame.time_base) if frame.duration else 0
                    else:
                        require(0 < frame.sample_rate <= 48000 and len(frame.layout.channels) <= 2)
                        samples += frame.samples * len(frame.layout.channels)
                        require(samples <= 4_500_000)
                        duration = frame.samples / frame.sample_rate
                    require(0 <= duration <= 2)
                    total['end'] = max(total['end'], at + duration)
            require(all(t['frames'] and t['first'] is not None for t in totals.values()))
            duration_ms = max(t['end'] for t in totals.values()) * 1000
            # Wall-clock capture includes recorder scheduling/encoder start-up.
            # Check decoded timestamps, never trust the optional Duration tag.
            require(0 < duration_ms <= 46000 and abs(duration_ms - expected_ms) <= max(2000, expected_ms * .15))
            require(not any(level <= av.logging.ERROR for level, _, _ in logs))
            return {'ok': True, 'kind': kind, 'hasAudio': has_audio,
                    'durationMs': round(duration_ms, 3),
                    'tracks': [{'type': t['type'], 'frames': t['frames']} for t in totals.values()]}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 4 and sys.argv[2] in ('true', 'false'))
        result = inspect(sys.stdin.buffer.read(MAX_BYTES + 1), sys.argv[1],
                         sys.argv[2] == 'true', float(sys.argv[3]))
    except Exception:
        print(json.dumps({'ok': False}), flush=True)
        sys.exit(1)
    print(json.dumps(result), flush=True)
