sap.ui.define([
    "sap/m/MessageToast"
], function(MessageToast) {
    'use strict';

    return {
        get_results: function () {
            this._aContexts = this.extensionAPI.getSelectedContexts();

            if (!this._aContexts.length) {
                MessageToast.show("No rows selected.");
                return;
            }

            this._iCurrentIndex = 0;
            this._iBatchSize = 200; // number of rows per batch
            this._aResults = [];
            this._bLoading = false;
            this._bDestroyed = false;
            this._oTable = null;
            this._oDialog = null;
            this._oModel = null;
            this._oExportButton = null;

            this.getView().setBusy(true);
            this._loadNextBatch();
        },

        // Load data in batches (called on scroll)
        _loadNextBatch: async function () {
            if (this._bLoading) return;
            if (this._bDestroyed) return;   // Stop if dialog closes
            if (this._iCurrentIndex >= this._aContexts.length) return;

            var that = this;
            var oModel = this.getView().getModel();
            var start = this._iCurrentIndex;
            var end = Math.min(start + this._iBatchSize, this._aContexts.length);
            var aBatch = this._aContexts.slice(start, end);

            this._bLoading = true;

            const MAX_PARALLEL = 20;    // Number of parallel calls

            // Process batch with limited parallel calls
            async function processWithLimit(items) {
                let results = [];
                for (let i = 0; i < items.length; i += MAX_PARALLEL) {
                    if (that._bDestroyed) return results;
                    let chunk = items.slice(i, i + MAX_PARALLEL);

                    // Create parallel calls for this chunk
                    let promises = chunk.map(function (oContext) {
                        let oData = oContext.getObject();
                        return new Promise(function (resolve) {
                            oModel.callFunction("/show_res", {
                                method: "POST",
                                urlParameters: {
                                    vtgrrnr: oData.vtgrrnr,
                                    Rank: oData.Rank,
                                    SequenceNumber: oData.SequenceNumber
                                },
                                success: function (oResult) {
                                    resolve(oResult.results || []);
                                },
                                error: function () {
                                    resolve([]);
                                }
                            });
                        });
                    });

                    // Wait for this chunk to finish
                    let chunkResults = await Promise.all(promises);
                    chunkResults.forEach(r => results.push(...r));  // Flatten results
                }
                return results;
            }

            try {
                const batchResults = await processWithLimit(aBatch);
                if (!this._bDestroyed) {
                    this._aResults.push(...batchResults);
                    this._iCurrentIndex = end;
                }
            } catch (e) {
                MessageToast.show("Unexpected error during batch load.");
            } finally {
                this._bLoading = false;
            }

            if (!this._bDestroyed) {
                this._updateTable();
                if (this._iCurrentIndex >= this._aContexts.length) {
                    this.getView().setBusy(false);
                }
            }
        },

        // Export full dataset
        _startExport: async function () {
            if (this._bDestroyed) return;

            var aExportResults = this._aResults.slice();
            if (aExportResults.length === 0 && this._iCurrentIndex >= this._aContexts.length) {
                MessageToast.show("No records to download.", { duration: 3000 });
                return;
            }

            var that = this;
            var oModel = this.getView().getModel();
            var total = this._aContexts.length;

            var aExportResults = this._aResults.slice();
            var iExportIndex = this._iCurrentIndex;

            const EXPORT_BATCH = 500;
            const MAX_PARALLEL = 100;
            const PAUSE_MS = 1000;  // Pause time in ms

            // Disable button + set dialog busy
            this._oExportButton.setEnabled(false);
            this._oExportButton.setText("Fetching...");
            this._oDialog.setBusy(true);

            async function processChunk(items) {
                let results = [];
                for (let i = 0; i < items.length; i += MAX_PARALLEL) {
                    if (that._bDestroyed) return results;
                    let chunk = items.slice(i, i + MAX_PARALLEL);
                    let promises = chunk.map(function (oContext) {
                        let oData = oContext.getObject();
                        return new Promise(function (resolve) {
                            oModel.callFunction("/show_res", {
                                method: "POST",
                                urlParameters: {
                                    vtgrrnr: oData.vtgrrnr,
                                    Rank: oData.Rank,
                                    SequenceNumber: oData.SequenceNumber
                                },
                                success: function (oResult) {
                                    resolve(oResult.results || []);
                                },
                                error: function () {
                                    resolve([]);
                                }
                            });
                        });
                    });
                    let chunkResults = await Promise.all(promises);
                    chunkResults.forEach(r => results.push(...r));
                }
                return results;
            }

            while (iExportIndex < total) {
                if (this._bDestroyed) return;

                var batchEnd = Math.min(iExportIndex + EXPORT_BATCH, total);
                var aBatch = this._aContexts.slice(iExportIndex, batchEnd);

                try {
                    var batchResults = await processChunk(aBatch);
                    aExportResults.push(...batchResults);
                    iExportIndex = batchEnd;

                    if (!this._bDestroyed) {
                        var msg = iExportIndex < total
                            ? "Fetched " + aExportResults.length + " records..."
                            : "Fetched all " + aExportResults.length + " records. Generating Excel...";

                        MessageToast.show(msg, { duration: 2000 });
                    }
                } catch (e) {
                    MessageToast.show("Error during export batch.");
                }

                if (iExportIndex < total) {
                    await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
                }
            }

            if (this._bDestroyed) return;

            // Remove busy before SAP export dialog opens
            this._oDialog.setBusy(false);

            this._exportToExcel(aExportResults, function () {
                MessageToast.show("Excel file downloaded with " + aExportResults.length + " records.", {
                    duration: 4000
                });

                if (!that._bDestroyed && that._oExportButton) {
                    that._oExportButton.setEnabled(true);
                    that._oExportButton.setText("Export");
                }
            });
        },

        _updateTable: function () {
            if (this._bDestroyed) return;

            var that = this;

            if (!this._oTable) {
                this._oModel = new sap.ui.model.json.JSONModel({ results: [] });

                this._oTable = new sap.m.Table({
                    growing: true,
                    growingThreshold: 50,
                    growingScrollToLoad: true,
                    columns: [
                        new sap.m.Column({ header: new sap.m.Text({ text: "TCR Number" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Object Type" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Source Object Number" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Process Ref ID" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Target Object Number" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Target System" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Message Type" }) }),
                        new sap.m.Column({ header: new sap.m.Text({ text: "Message" }) })
                    ]
                });

                this._oTable.setModel(this._oModel);

                this._oTable.bindItems({
                    path: "/results",
                    template: new sap.m.ColumnListItem({
                        cells: [
                            new sap.m.Text({ text: "{mvtgrrnr}" }),
                            new sap.m.Text({ text: "{object_type}" }),
                            new sap.m.Text({ text: "{vtgrrnr}" }),
                            new sap.m.Text({ text: "{processingID}" }),
                            new sap.m.Text({ text: "{CreatedTCR}" }),
                            new sap.m.Text({ text: "{syst}" }),
                            new sap.m.Text({ text: "{type}" }),
                            new sap.m.Text({ text: "{message}" })
                        ]
                    })
                });

                this._oTable.attachGrowingStarted(function () {
                    if (that._bDestroyed) return;
                    var total = that._aContexts.length;
                    var loaded = that._iCurrentIndex;
                    if (loaded < total && !that._bLoading) {
                        that._loadNextBatch();
                    }
                });

                this._oExportButton = new sap.m.Button({
                    text: "Export",
                    type: "Emphasized",
                    press: function () {
                        that._startExport();
                    }
                });

                this._oDialog = new sap.m.Dialog({
                    title: "TCR Copy Logs",
                    contentWidth: "90%",
                    contentHeight: "80%",
                    content: [this._oTable],
                    buttons: [
                        this._oExportButton,
                        new sap.m.Button({
                            text: "Close",
                            press: function () {
                                that._oDialog.close();
                            }
                        })
                    ],
                    afterClose: function () {
                        that._bDestroyed = true;
                        that._oDialog.destroy();
                        that._oDialog = null;
                        that._oTable = null;
                        that._oModel = null;
                        that._oExportButton = null;
                        that._aResults = [];
                        that._iCurrentIndex = 0;
                        that._bLoading = false;
                        that.getView().setBusy(false);
                    }
                });

                this._oDialog.open();
            }

            this._oModel.setProperty("/results", this._aResults);
        },

        _exportToExcel: function (aData, fnCallback) {
            var aCols = [
                { label: "TCR Number", property: "mvtgrrnr" },
                { label: "Object Type", property: "object_type" },
                { label: "Source Object Number", property: "vtgrrnr" },
                { label: "Process Ref ID", property: "processingID" },
                { label: "Target Object Number", property: "CreatedTCR" },
                { label: "Target System", property: "syst" },
                { label: "Message Type", property: "type" },
                { label: "Message", property: "message" }
            ];

            var oSheet = new Spreadsheet({
                workbook: { columns: aCols },
                dataSource: aData,
                fileName: "TCR_Copy_Results.xlsx"
            });

            oSheet.build()
                .then(function () {
                    if (fnCallback) fnCallback();
                })
                .finally(function () {
                    oSheet.destroy();
                });
        }
    }
});
