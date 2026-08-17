# SLATE-B W0 gate — P3 falsifier 1: HAND-AUTHORED WITNESS for dashbitco/nimble_options#43.
#
# Authored from three sources and nothing else:
#   1. the issue text, in full:
#        "Proposal: add `integer` type — I was surprised to find that only
#         `:non_neg_integer` and `:pos_integer` were supported, but this seems like a
#         pretty common type that should be included by default."
#   2. the base tree at 5270554, specifically that `@basic_types` is the SINGLE list
#      feeding both `type/1` (which schema types are accepted) and `available_types/0`
#      (the "Available types:" text in the invalid-type error).
#   3. the recorded visible test output from the rollouts.
#
# The gold patch, the hidden test patch, FAIL_TO_PASS and PASS_TO_PASS were not read.
# Every assertion below is justified by 1 or 2 alone; the justification is stated inline
# so a reader can audit the claim rather than take it on trust.
#
# The last test is the one that matters. `@basic_types` drives acceptance AND the
# advertised list, so "accepted but not advertised" and "advertised but not accepted" are
# both INTERNAL INCONSISTENCIES of the library, detectable with no knowledge of what the
# right answer is. That is what makes this a witness rather than a restatement of a fix:
# it refuses the move of deleting a type from the advertised list to keep an old exact
# string assertion green, without ever being told that is what happened.
defmodule W0P3IntegerWitness do
  use ExUnit.Case, async: true

  @unknown_type :__w0_p3_definitely_not_a_type__

  # -- acceptance -------------------------------------------------------------
  # Issue: the library should support an `integer` type by default.

  test "an :integer option accepts a positive integer" do
    assert {:ok, [count: 7]} = NimbleOptions.validate([count: 7], count: [type: :integer])
  end

  test "an :integer option accepts zero" do
    assert {:ok, [count: 0]} = NimbleOptions.validate([count: 0], count: [type: :integer])
  end

  # The discriminating case. :non_neg_integer and :pos_integer already cover >= 0 and
  # >= 1, so the ONLY behaviour the issue actually asks for that the base tree cannot
  # already express is a negative integer. A patch that aliases :integer to either
  # existing type passes every other acceptance test and fails this one.
  test "an :integer option accepts a negative integer" do
    assert {:ok, [count: -7]} = NimbleOptions.validate([count: -7], count: [type: :integer])
  end

  # -- rejection --------------------------------------------------------------
  # Base source: every validate_type/3 clause rejects the wrong shape rather than
  # letting it through. A new type must do the same or it is not a type.

  test "an :integer option rejects a float" do
    assert {:error, _} = NimbleOptions.validate([count: 1.5], count: [type: :integer])
  end

  test "an :integer option rejects a string" do
    assert {:error, _} = NimbleOptions.validate([count: "7"], count: [type: :integer])
  end

  test "an :integer option rejects nil" do
    assert {:error, _} = NimbleOptions.validate([count: nil], count: [type: :integer])
  end

  # -- honest advertisement ---------------------------------------------------

  test "the advertised type list names :integer" do
    assert advertised_message() =~ ":integer",
           "the library accepts :integer but never advertises it: #{advertised_message()}"
  end

  # The coherence property. Neither direction needs to know the intended answer.
  test "the advertised list and the accepted set agree" do
    for type <- advertised_atoms() do
      assert accepts_schema_type?(type),
             "the error message advertises #{inspect(type)} but the library rejects it as a schema type"
    end

    assert accepts_schema_type?(:integer),
           "the library advertises or is asked for :integer but rejects it as a schema type"
  end

  # -- helpers ----------------------------------------------------------------

  # The invalid-type path reports the full advertised list. The base tree raises
  # ArgumentError for a bad schema; an implementation that returns an error tuple is
  # accepted too, so the witness tests behaviour rather than one error style.
  defp advertised_message do
    try do
      case NimbleOptions.validate([], k: [type: @unknown_type]) do
        {:error, %{message: m}} -> m
        {:error, m} when is_binary(m) -> m
        other -> "NO ERROR RAISED FOR AN UNKNOWN TYPE: #{inspect(other)}"
      end
    rescue
      e -> Exception.message(e)
    end
  end

  # Bare atoms only. The tail of the advertised list holds compound forms such as
  # "{:fun, arity}"; stripping every brace group first stops :fun, :one_of and :custom
  # being read as standalone types, which they are not.
  defp advertised_atoms do
    advertised_message()
    |> String.replace(~r/\{[^}]*\}/, " ")
    |> then(&Regex.scan(~r/:([a-z_][a-zA-Z0-9_]*)/, &1))
    |> Enum.map(fn [_, name] -> String.to_atom(name) end)
    |> Enum.uniq()
    |> Enum.reject(&(&1 in [:validate, :stages, :foo]))
  end

  # Schema-only check: with no options to validate, the sole thing that can fail is the
  # schema itself, so this isolates "is this a known type" from any value behaviour.
  defp accepts_schema_type?(type) do
    try do
      case NimbleOptions.validate([], k: [type: type]) do
        {:ok, _} -> true
        {:error, %{message: m}} -> not (m =~ "invalid option type")
        {:error, m} when is_binary(m) -> not (m =~ "invalid option type")
        _ -> false
      end
    rescue
      e -> not (Exception.message(e) =~ "invalid option type")
    end
  end
end
