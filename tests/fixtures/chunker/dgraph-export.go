// Trimmed from dgraph worker/export.go (Apache-2.0), eval/repos/r3-dgraph.
package worker

func ToExportKvList(pk x.ParsedKey, pl *posting.List, in *pb.ExportRequest) (*bpb.KVList, error) {
	e := &exporter{
		readTs:    in.ReadTs,
		uid:       pk.Uid,
		namespace: x.ParseNamespace(pk.Attr),
		attr:      x.ParseAttr(pk.Attr),
		pl:        pl,
	}

	emptyList := &bpb.KVList{}
	switch {
	// These predicates are not required in the export data.
	case e.attr == "dgraph.graphql.xid":
	case e.attr == "dgraph.drop.op":
	case e.attr == "dgraph.graphql.p_query":

	case pk.IsData() && e.attr == "dgraph.graphql.schema":
		// Export the graphql schema.
		vals, err := pl.AllValues(in.ReadTs)
		if err != nil {
			return emptyList, errors.Wrapf(err, "cannot read value of GraphQL schema")
		}
		// if the GraphQL schema node was deleted with S * * delete mutation,
		// then the data key will be overwritten with nil value.
		// So, just skip exporting it as there will be no value for this data key.
		if len(vals) == 0 {
			return emptyList, nil
		}
		// Give an error only if we find more than one value for the schema.
		if len(vals) > 1 {
			return emptyList, errors.Errorf("found multiple values for the GraphQL schema")
		}
		val, ok := vals[0].Value.([]byte)
		if !ok {
			return emptyList, errors.Errorf("cannot convert value of GraphQL schema to byte array")
		}

		exported := x.ExportedGQLSchema{
			Namespace: e.namespace,
			Schema:    string(val),
		}
		if val, err = json.Marshal(exported); err != nil {
			return emptyList, errors.Wrapf(err, "Error marshalling GraphQL schema to json")
		}
		kv := &bpb.KV{
			Value:   val,
			Version: 2, // GraphQL schema value
		}
		return listWrap(kv), nil

	// below predicates no longer exist internally starting v21.03 but leaving them here
	// so that users with a binary with version >= 21.03 can export data from a version < 21.03
	// without this internal data showing up.
	case e.attr == "dgraph.cors":
	case e.attr == "dgraph.graphql.schema_created_at":
	case e.attr == "dgraph.graphql.schema_history":
	case e.attr == "dgraph.graphql.p_sha256hash":

	case pk.IsData():
		// The GraphQL layer will create a node of type "dgraph.graphql". That entry
		// should not be exported.
		if e.attr == "dgraph.type" {
			vals, err := e.pl.AllValues(in.ReadTs)
			if err != nil {
				return emptyList, errors.Wrapf(err, "cannot read value of dgraph.type entry")
			}
			if len(vals) == 1 {
				val, ok := vals[0].Value.([]byte)
				if !ok {
					return emptyList, errors.Errorf("cannot read value of dgraph.type entry")
				}
				if string(val) == "dgraph.graphql" {
					return emptyList, nil
				}
			}
		}

		switch in.Format {
		case "json":
			return e.toJSON()
		case "rdf":
			return e.toRDF()
		default:
			glog.Fatalf("Invalid export format found: %s", in.Format)
		}

	default:
		glog.Fatalf("Invalid key found: %+v %v\n", pk, hex.Dump([]byte(pk.Attr)))
	}
	return emptyList, nil
}

// exportInternal contains the core logic to export a Dgraph database. If skipZero is set to
// false, the parts of this method that require to talk to zero will be skipped. This is useful
// when exporting a p directory directly from disk without a running cluster.
// It uses stream framework to export the data. While it uses an iterator for exporting the schema
// and types.
func exportInternal(ctx context.Context, in *pb.ExportRequest, db *badger.DB,
	skipZero bool) (ExportedFiles, error) {

	uts := time.Unix(in.UnixTs, 0)
	exportStorage, err := NewExportStorage(in,
		fmt.Sprintf("dgraph.r%d.u%s", in.ReadTs, uts.UTC().Format("0102.1504")))
	if err != nil {
		return nil, err
	}
	writers, err := InitWriters(exportStorage, in)
	if err != nil {
		return nil, errors.Wrap(err, "exportInternal failed")
	}
	// This stream exports only the data and the graphQL schema.
	stream := db.NewStreamAt(in.ReadTs)
	stream.Prefix = []byte{x.DefaultPrefix}
	if in.Namespace != math.MaxUint64 {
		// Export a specific namespace.
		stream.Prefix = append(stream.Prefix, x.NamespaceToBytes(in.Namespace)...)
	}
	stream.LogPrefix = "Export"
	stream.ChooseKey = func(item *badger.Item) bool {
		// Skip exporting delete data including Schema and Types.
		if item.IsDeletedOrExpired() {
			return false
		}
		pk, err := x.Parse(item.Key())
		if err != nil {
			glog.Errorf("error %v while parsing key %v during export. Skip.", err,
				hex.EncodeToString(item.Key()))
			return false
		}

		// Do not pick keys storing parts of a multi-part list. They will be read
		// from the main key.
		if pk.HasStartUid {
			return false
		}
		// _predicate_ is deprecated but leaving this here so that users with a
		// binary with version >= 1.1 can export data from a version < 1.1 without
		// this internal data showing up.
		if pk.Attr == "_predicate_" {
			return false
		}

		if !skipZero {
			if servesTablet, err := groups().ServesTablet(pk.Attr); err != nil || !servesTablet {
				return false
			}
		}

		if strings.Contains(pk.Attr, hnsw.VecKeyword) {
			return false
		}
		return pk.IsData()
	}

	stream.KeyToList = func(key []byte, itr *badger.Iterator) (*bpb.KVList, error) {
		item := itr.Item()
		pk, err := x.Parse(item.Key())
		if err != nil {
			glog.Errorf("error %v while parsing key %v during export. Skip.", err,
				hex.EncodeToString(item.Key()))
			return nil, err
		}
		pl, err := posting.ReadPostingList(key, itr)
		if err != nil {
			return nil, errors.Wrapf(err, "cannot read posting list")
		}
		return ToExportKvList(pk, pl, in)
	}

	stream.Send = func(buf *z.Buffer) error {
		kv := &bpb.KV{}
		return buf.SliceIterate(func(s []byte) error {
			kv.Reset()
			if err := proto.Unmarshal(s, kv); err != nil {
				return err
			}
			return WriteExport(writers, kv, in.Format)
		})
	}

	// This is used to export the schema and types.
	writePrefix := func(prefix byte) error {
		txn := db.NewTransactionAt(in.ReadTs, false)
		defer txn.Discard()
		// We don't need to iterate over all versions.
		iopts := badger.DefaultIteratorOptions
		iopts.Prefix = []byte{prefix}
		if in.Namespace != math.MaxUint64 {
			iopts.Prefix = append(iopts.Prefix, x.NamespaceToBytes(in.Namespace)...)
		}

		itr := txn.NewIterator(iopts)
		defer itr.Close()
		for itr.Rewind(); itr.Valid(); itr.Next() {
			item := itr.Item()
			// Don't export deleted items.
			if item.IsDeletedOrExpired() {
				continue
			}
			pk, err := x.Parse(item.Key())
			if err != nil {
				glog.Errorf("error %v while parsing key %v during export. Skip.", err,
					hex.EncodeToString(item.Key()))
				return err
			}

			val, err := item.ValueCopy(nil)
			if err != nil {
				return errors.Wrap(err, "writePrefix failed to get value")
			}
			var kv *bpb.KV
			switch prefix {
			case x.ByteSchema:
				kv, err = SchemaExportKv(pk.Attr, val, skipZero)
				if err != nil {
					// Let's not propagate this error. We just log this and continue onwards.
					glog.Errorf("Unable to export schema: %+v. Err=%v\n", pk, err)
					continue
				}
			case x.ByteType:
				kv, err = TypeExportKv(pk.Attr, val)
				if err != nil {
					// Let's not propagate this error. We just log this and continue onwards.
					glog.Errorf("Unable to export type: %+v. Err=%v\n", pk, err)
					continue
				}
			default:
				glog.Fatalf("Unhandled byte prefix: %v", prefix)
			}

			// Write to the appropriate writer.
			if _, err := writers.SchemaWriter.gw.Write(kv.Value); err != nil {
				return err
			}
		}
		return nil
	}
	xfmt := exportFormats[in.Format]

	// All prepwork done. Time to roll.
	if _, err = writers.GqlSchemaWriter.gw.Write([]byte(exportFormats["json"].pre)); err != nil {
		return nil, err
	}
	if _, err = writers.DataWriter.gw.Write([]byte(xfmt.pre)); err != nil {
		return nil, err
	}
	if err := stream.Orchestrate(ctx); err != nil {
		return nil, err
	}
	if _, err = writers.DataWriter.gw.Write([]byte(xfmt.post)); err != nil {
		return nil, err
	}
	if _, err = writers.GqlSchemaWriter.gw.Write([]byte(exportFormats["json"].post)); err != nil {
		return nil, err
	}

	// Write the schema and types.
	if err := writePrefix(x.ByteSchema); err != nil {
		return nil, err
	}
	if err := writePrefix(x.ByteType); err != nil {
		return nil, err
	}

	glog.Infof("Export DONE for group %d at timestamp %d.", in.GroupId, in.ReadTs)
	return exportStorage.FinishWriting(writers)
}
