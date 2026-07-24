sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/BusyIndicator"
], function (MessageToast, Spreadsheet, JSONModel, BusyIndicator) {
    "use strict";

    return {
        /*
        /* Method get_results
        /* Fetch process logs for selected TCRs
        */
        get_results: function () {
            const aContexts = this.extensionAPI.getSelectedContexts();

            if (!aContexts || !aContexts.length) {
                MessageToast.show("No rows selected");
                return;
            }

            // Get unique TCR numbers from selected contexts
            const mUnique = {};
            aContexts.forEach(function (oContext) {
                const oObj = oContext.getObject();
                mUnique[oObj.vtgrrnr] = oObj;
            });
            const aUniqueContextObjects = Object.values(mUnique);

            // Split selected TCRs into two groups:
            // - Replicated: has a ProcessingId, so real log data exists in the backend
            // - Not Replicated: no ProcessingId yet, nothing to fetch for these
            const aReplicated = [];
            const aNotReplicated = [];
            aUniqueContextObjects.forEach(function (oObj) {
                const sPid = oObj.processingID;
                if (sPid && sPid.trim() !== "") {
                    aReplicated.push(oObj);
                } else {
                    aNotReplicated.push(oObj);
                }
            });

            // Fallback rows for TCRs that haven't been replicated yet (client-side, shown separately)
            const aFallbackRows = aNotReplicated.map(function (oObj) {
                const sTcr = String(oObj.vtgrrnr).padStart(20, "0");
                return {
                    TCRNumber: sTcr,
                    ObjectType: "TCR",
                    SourceNumber: sTcr,
                    ProcessingId: "",
                    TargetNumber: "",
                    Systemm: "",
                    Type: "",
                    Message: "TCR " + oObj.vtgrrnr + " has not yet been replicated"
                };
            });

            if (!aReplicated.length) {
                this._oLastFilter = null;
                this._aLastSorters = null;
                this._aLastFallbackRows = aFallbackRows;
                this._showResultDialog(null, null, aFallbackRows);
                return;
            }

            // Collect unique ProcessingIds
            const aProcessingIds = [];
            aReplicated.forEach(function (oObj) {
                const sPid = oObj.processingID;
                if (!aProcessingIds.includes(sPid)) {
                    aProcessingIds.push(sPid);
                }
            });

            // Collect unique TCR numbers
            const aSelectedTCRs = aReplicated.map(function (oObj) {
                return String(oObj.vtgrrnr).padStart(20, "0");
            });

            // Build filters for processing id and selected TCRs
            const aPidFilters = aProcessingIds.map(function (sPid) {
                return new sap.ui.model.Filter("ProcessingId", sap.ui.model.FilterOperator.EQ, sPid);
            });
            const oPidFilter = new sap.ui.model.Filter({ filters: aPidFilters, and: false });

            const aTCRFilters = this._buildRangeFilters(aSelectedTCRs, "ParentTCR");
            const oTCRFilter = new sap.ui.model.Filter({ filters: aTCRFilters, and: false });

            const oCombinedFilter = new sap.ui.model.Filter({
                filters: [oPidFilter, oTCRFilter],
                and: true
            });

            // Build a map from ProcessingId -> TCR number for the display formatter
            const mapPidToTcr = {};
            aReplicated.forEach(function (oObj) {
                mapPidToTcr[String(oObj.processingID)] = String(oObj.vtgrrnr).padStart(20, "0");
            });
            this._mapPidToTcr = mapPidToTcr;

            const aSorters = [
                new sap.ui.model.Sorter("ParentTCR"),
                new sap.ui.model.Sorter("ProcessingId"),
                new sap.ui.model.Sorter("ObjectType"),
                new sap.ui.model.Sorter("SourceNumber")
            ];

            // Keep these around so the Export button can re-fetch the full set on demand
            this._oLastFilter = oCombinedFilter;
            this._aLastSorters = aSorters;
            this._aLastFallbackRows = aFallbackRows;

            this._showResultDialog(oCombinedFilter, aSorters, aFallbackRows);
        },

        /*
        /* Method _buildRangeFilters
        /* Convert a list of (padded) numeric strings into contiguous range filters.
        /* e.g. [1,2,3,5,6,9] -> BT(1,3), BT(5,6), EQ(9)
        */
        _buildRangeFilters: function (aValues, sFieldName) {
            if (!aValues || !aValues.length) {
                return [];
            }

            // Sort numerically
            const aSorted = aValues.slice().sort(function (a, b) {
                return Number(a) - Number(b);
            });

            // Remove if any duplicates (e.g. if user selected same TCR multiple times)
            const aUnique = aSorted.filter(function (sVal, i) {
                return i === 0 || Number(sVal) !== Number(aSorted[i - 1]);
            });

            // Group into contiguous ranges
            const aRanges = [];
            let sStart = aUnique[0];
            let sPrev = aUnique[0];

            for (let i = 1; i < aUnique.length; i++) {
                const sCurrent = aUnique[i];
                if (Number(sCurrent) === Number(sPrev) + 1) {
                    sPrev = sCurrent;   // still contiguous, extend
                } else {
                    aRanges.push({ start: sStart, end: sPrev });    // break found, close range
                    sStart = sCurrent;
                    sPrev = sCurrent;
                }
            }
            aRanges.push({ start: sStart, end: sPrev });

            // Build filters: single value -> EQ, range -> BT
            return aRanges.map(function (oRange) {
                return oRange.start === oRange.end
                    ? new sap.ui.model.Filter(sFieldName, sap.ui.model.FilterOperator.EQ, oRange.start)
                    : new sap.ui.model.Filter(sFieldName, sap.ui.model.FilterOperator.BT, oRange.start, oRange.end);
            });
        },

        /*
        /* Method _showResultDialog
        /* Display logs in a dialog table
        */
        _showResultDialog: function (oFilter, aSorters, aFallbackRows) {
            const that = this;
            const oModel = this.getView().getModel();

            const fnBuildColumns = function () {
                return [
                    new sap.m.Column({ width: "18%", header: new sap.m.Text({ text: "TCR Number" }) }),
                    new sap.m.Column({ width: "10%", header: new sap.m.Text({ text: "Object Type" }) }),
                    new sap.m.Column({ width: "18%", header: new sap.m.Text({ text: "Source Object Number" }) }),
                    new sap.m.Column({ width: "18%", header: new sap.m.Text({ text: "Process Ref ID" }) }),
                    new sap.m.Column({ width: "18%", header: new sap.m.Text({ text: "Target Object Number" }) }),
                    new sap.m.Column({ width: "12%", header: new sap.m.Text({ text: "Target System" }) }),
                    new sap.m.Column({ width: "8%", header: new sap.m.Text({ text: "Message Type" }), hAlign: "Center" }),
                    new sap.m.Column({ width: "25%", header: new sap.m.Text({ text: "Message" }) })
                ];
            };

            const aDialogContent = [];

            // Panel 1: For TCRs data not yet replicated
            if (aFallbackRows && aFallbackRows.length) {
                const oFallbackModel = new JSONModel({ results: aFallbackRows });
                const oFallbackTable = new sap.m.Table({
                    columns: fnBuildColumns(),
                    items: {
                        path: "/results",
                        template: new sap.m.ColumnListItem({
                            cells: [
                                new sap.m.Text({ text: "{TCRNumber}" }),
                                new sap.m.Text({ text: "{ObjectType}" }),
                                new sap.m.Text({ text: "{SourceNumber}" }),
                                new sap.m.Text({ text: "{ProcessingId}" }),
                                new sap.m.Text({ text: "{TargetNumber}" }),
                                new sap.m.Text({ text: "{Systemm}" }),
                                new sap.m.Text({ text: "{Type}" }),
                                new sap.m.Text({ text: "{Message}" })
                            ]
                        })
                    }
                });
                oFallbackTable.setModel(oFallbackModel);

                const oFallbackPanel = new sap.m.Panel({
                    expandable: true,
                    expanded: true,
                    headerToolbar: new sap.m.Toolbar({
                        content: [
                            new sap.ui.core.Icon({ src: "sap-icon://message-warning", color: "Critical" }).addStyleClass("sapUiTinyMarginEnd"),
                            new sap.m.Title({ text: "TCRs Not Yet Replicated (" + aFallbackRows.length + ")", level: "H3" })
                        ]
                    }),
                    content: [oFallbackTable]
                }).addStyleClass("sapUiSmallMarginBottom");

                aDialogContent.push(oFallbackPanel);
            }

            // Panel 2: For TCRs data that are replicated
            let oMainTable = null;
            let oMainPanel = null;
            if (oFilter) {
                oMainTable = new sap.m.Table({
                    growing: true,
                    growingThreshold: 100,       // page size per backend request
                    growingScrollToLoad: true,   // fetch next page automatically on scroll
                    noDataText: "No log entries found",
                    columns: fnBuildColumns()
                });
                oMainTable.setBusyIndicatorDelay(0);
                oMainTable.setBusy(true);

                oMainTable.setModel(oModel);
                oMainTable.bindItems({
                    path: "/ProcessLog",
                    filters: [oFilter],
                    sorters: aSorters,
                    parameters: {
                        // ensures filtering/sorting/paging happens on the backend, not client-side
                        operationMode: "Server"
                    },
                    template: new sap.m.ColumnListItem({
                        cells: [
                            new sap.m.Text({
                                text: {
                                    parts: [{ path: "ParentTCR" }, { path: "ProcessingId" }],
                                    formatter: function (sParentTCR, sProcessingId) {
                                        if (sParentTCR) {
                                            return sParentTCR;
                                        }
                                        return (that._mapPidToTcr && that._mapPidToTcr[String(sProcessingId)]) || "";
                                    }
                                }
                            }),
                            new sap.m.Text({ text: "{ObjectType}" }),
                            new sap.m.Text({ text: "{SourceNumber}" }),
                            new sap.m.Text({ text: "{ProcessingId}" }),
                            new sap.m.Text({ text: "{TargetNumber}" }),
                            new sap.m.Text({ text: "{Systemm}" }),
                            new sap.m.Text({ text: "{Type}" }),
                            new sap.m.Text({ text: "{Message}" })
                        ]
                    })
                });

                oMainPanel = new sap.m.Panel({
                    expandable: true,
                    expanded: true,
                    headerToolbar: new sap.m.Toolbar({
                        content: [
                            new sap.ui.core.Icon({ src: "sap-icon://accept", color: "Positive" }).addStyleClass("sapUiTinyMarginEnd"),
                            new sap.m.Title({ text: "TCRs Replicated", level: "H3" })
                        ]
                    }),
                    content: [oMainTable]
                });

                aDialogContent.push(oMainPanel);
            }

            const oExportButton = new sap.m.Button({
                text: "Export",
                type: "Emphasized",
                press: function () {
                    that._exportToExcel();
                }
            });

            const oDialog = new sap.m.Dialog({
                title: "TCR Copy Logs",
                contentWidth: "90%",
                contentHeight: "80%",
                resizable: true,
                draggable: true,
                content: aDialogContent,
                buttons: [
                    oExportButton,
                    new sap.m.Button({
                        text: "Close",
                        press: function () {
                            oDialog.close();
                        }
                    })
                ],
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            if (oMainTable) {
                BusyIndicator.show(0);
                oMainTable.getBinding("items").attachEventOnce("dataReceived", function () {
                    BusyIndicator.hide();
                    oMainTable.setBusy(false);
                    oDialog.open();    // Open the dialog
                });
            } else {
                oDialog.open();
            }
        },

        /*
        /* Method _exportToExcel
        /* Export data to excel i.e., 5000 each time
        */
        _exportToExcel: function () {
            const that = this;
            const aFallbackRows = this._aLastFallbackRows || [];

            const fnDoExport = function (aData) {
                if (!aData || !aData.length) {
                    MessageToast.show("No records to export");
                    return;
                }

                const aCols = [
                    { label: "TCR Number", property: "TCRNumber" },
                    { label: "Process Ref ID", property: "ProcessingId" },
                    { label: "Object Type", property: "ObjectType" },
                    { label: "Source Object Number", property: "SourceNumber" },
                    { label: "Message Type", property: "Type" },
                    { label: "Message", property: "Message" },
                    { label: "Target Object Number", property: "TargetNumber" },
                    { label: "System", property: "Systemm" }
                ];

                const oSheet = new Spreadsheet({
                    workbook: { columns: aCols },
                    dataSource: aData,
                    fileName: "TCR_Copy_Log.xlsx"
                });

                oSheet.build()
                    .then(function () {
                        MessageToast.show("Excel downloaded successfully");
                    })
                    .finally(function () {
                        oSheet.destroy();
                    });
            };

            if (!this._oLastFilter) {
                // If there is no filter for processing id, then it is only fallback rows
                fnDoExport(aFallbackRows);
                return;
            }

            // If there are filters, then fetch data and downlaod to excel
            const iBatchSize = 5000;
            let aAllResults = [];
            const oModel = this.getView().getModel();

            BusyIndicator.show(0);

            const fnReadBatch = function (iSkip, iKnownTotal) {
                oModel.read("/ProcessLog", {
                    filters: [that._oLastFilter],
                    sorters: that._aLastSorters,
                    urlParameters: Object.assign(
                        { "$top": iBatchSize, "$skip": iSkip },
                        // ask for the total count only on the very first request
                        iSkip === 0 ? { "$inlinecount": "allpages" } : {}
                    ),
                    success: function (oData) {
                        const aBatch = (oData.results || []).map(function (oLog) {
                            return Object.assign({}, oLog, {
                                TCRNumber: oLog.ParentTCR || (that._mapPidToTcr && that._mapPidToTcr[String(oLog.ProcessingId)]) || ""
                            });
                        });
                        aAllResults = aAllResults.concat(aBatch);

                        const iTotal = (iSkip === 0 && oData.__count) ? parseInt(oData.__count, 10) : iKnownTotal;

                        MessageToast.show(
                            iTotal
                                ? "Loaded " + aAllResults.length + " of " + iTotal + " rows..."
                                : "Loaded " + aAllResults.length + " rows so far..."
                        );

                        // a full batch came back -> there might be more, ask for the next page
                        const bMoreDataLikely = aBatch.length === iBatchSize;
                        if (bMoreDataLikely) {
                            fnReadBatch(iSkip + iBatchSize, iTotal);
                        } else {
                            BusyIndicator.hide();
                            const aFinalResults = aAllResults.concat(aFallbackRows);
                            aFinalResults.sort(function (a, b) {
                                return Number(a.TCRNumber) - Number(b.TCRNumber);
                            });
                            MessageToast.show("All " + aFinalResults.length + " rows loaded. Preparing Excel file...");
                            fnDoExport(aFinalResults);
                        }
                    },
                    error: function () {
                        BusyIndicator.hide();
                        MessageToast.show("Error fetching process logs for export");
                    }
                });
            };

            fnReadBatch(0, null);
        }
    };
});