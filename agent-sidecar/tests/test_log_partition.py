from src.log_partition import partition_logs


def test_pure_stdout():
    assert partition_logs("hello\nworld\n") == ("hello\nworld\n", "")


def test_pure_stderr():
    raw = "__SBSTDERR__:oops\n__SBSTDERR__:bad\n"
    assert partition_logs(raw) == ("", "oops\nbad\n")


def test_mixed_preserves_order_per_stream():
    raw = "out1\n__SBSTDERR__:err1\nout2\n__SBSTDERR__:err2\n"
    stdout, stderr = partition_logs(raw)
    assert stdout == "out1\nout2\n"
    assert stderr == "err1\nerr2\n"


def test_empty_input():
    assert partition_logs("") == ("", "")


def test_line_without_trailing_newline_preserved():
    raw = "out1\n__SBSTDERR__:err1"
    stdout, stderr = partition_logs(raw)
    assert stdout == "out1\n"
    assert stderr == "err1"
